import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .audit import audit
from .config import settings as cfg
from .models import (PS, ApiKey, ApiUsage, MerchantSettings, PaymentLink,
                     PaymentRequest, ReceivingAccount, User, utcnow)
from .qr import build_upi_uri

IST = timezone(timedelta(hours=5, minutes=30))
EXPIRY = {"1m": 60, "5m": 300, "30m": 1800, "1h": 3600, "2h": 7200, "24h": 86400}


def merchant_code(user_id: int) -> str:
    return f"M{user_id:06d}"


def pay_base() -> str:
    base = cfg.public_pay_base.strip() or (cfg.frontend_origins.split(",")[0].strip() if cfg.frontend_origins else "")
    return base.rstrip("/")


def pay_url(slug: str) -> str:
    return f"{pay_base()}/pay/{slug}"


def resolve_active(db, merchant_id: int):
    """(settings_row, account_id | None, upi_id) for the receiving account that new QRs should pay into."""
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == merchant_id))
    if not s:
        raise ValueError("Set up your receiving account first")
    if s.active_account_id:
        a = db.get(ReceivingAccount, s.active_account_id)
        if a and a.merchant_id == merchant_id and a.upi_id:
            return s, a.id, a.upi_id
    if not s.upi_id:
        raise ValueError("Add your UPI ID in Integrations first")
    return s, None, s.upi_id


def create_payment_request(db, merchant_id: int, s: MerchantSettings, amount_paise: int, ttl_seconds: int,
                           actor: str, customer_name: str | None = None, link_id: int | None = None,
                           account_id: int | None = None, upi_id: str | None = None) -> PaymentRequest:
    now = utcnow()
    p = PaymentRequest(merchant_id=merchant_id, reference="PAY" + secrets.token_hex(5).upper(),
                       amount_paise=amount_paise, status=PS.CREATED, created_at=now,
                       expires_at=now + timedelta(seconds=ttl_seconds),
                       customer_name=(customer_name or None), link_id=link_id, account_id=account_id)
    p.upi_uri = build_upi_uri(upi_id or s.upi_id, s.store_name, amount_paise, p.reference)
    db.add(p)
    db.flush()
    p.status = PS.WAITING
    audit(db, actor, "payment.created", f"payment:{p.id}", f"{p.reference} {amount_paise/100:.2f} INR")
    return p


def create_link(db, merchant_id: int, amount_paise: int, ttl_seconds: int, customer_name: str | None = None,
                order_id: str | None = None, redirect_url: str | None = None, source: str = "dashboard") -> PaymentLink:
    now = utcnow()
    link = PaymentLink(slug="pl_" + secrets.token_hex(4).upper(), merchant_id=merchant_id, amount_paise=amount_paise,
                       customer_name=customer_name or None, order_id=order_id or None,
                       redirect_url=redirect_url or None, source=source,
                       expires_at=now + timedelta(seconds=ttl_seconds), created_at=now)
    db.add(link)
    db.flush()
    audit(db, f"user:{merchant_id}", "link.created", f"link:{link.slug}", f"{amount_paise/100:.2f} INR via {source}")
    return link


def link_state(db, link: PaymentLink):
    """Returns (status, current_request, all_requests). status: ACTIVE|PAID|PENDING_VERIFICATION|REVIEW|EXPIRED."""
    reqs = db.scalars(select(PaymentRequest).where(PaymentRequest.link_id == link.id)
                      .order_by(PaymentRequest.id.desc())).all()
    paid = next((r for r in reqs if r.status == PS.VERIFIED), None)
    pending = next((r for r in reqs if r.status in (PS.DETECTED, PS.VERIFYING)), None)
    review = next((r for r in reqs if r.status == PS.REVIEW), None)
    if paid:
        return "PAID", paid, reqs
    if pending:
        return "PENDING_VERIFICATION", pending, reqs
    if review:
        return "REVIEW", review, reqs
    if utcnow() >= link.expires_at:
        return "EXPIRED", (reqs[0] if reqs else None), reqs
    return "ACTIVE", (reqs[0] if reqs else None), reqs


def start_session(db, link: PaymentLink):
    """Reuse a live QR for this link or create a fresh 5-minute one. Never creates a second QR
    while a payment for the link is already detected / awaiting review."""
    st, cur, reqs = link_state(db, link)
    if st != "ACTIVE":
        return st, cur
    now = utcnow()
    live = next((r for r in reqs if r.status in (PS.CREATED, PS.WAITING) and r.expires_at > now), None)
    if live:
        return "ACTIVE", live
    merchant = db.get(User, link.merchant_id)
    try:
        if not merchant or not merchant.is_active:
            raise ValueError
        s, account_id, upi = resolve_active(db, link.merchant_id)
    except ValueError:
        raise ValueError("This merchant cannot accept payments right now")
    ttl = min(cfg.qr_expiry_seconds, int((link.expires_at - now).total_seconds()))
    if ttl < 5:
        return "EXPIRED", cur
    p = create_payment_request(db, link.merchant_id, s, link.amount_paise, ttl, "customer", link.customer_name, link.id,
                               account_id=account_id, upi_id=upi)
    db.commit()
    return "ACTIVE", p


# ---- API keys ----
def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def roll_api_key(db, merchant_id: int) -> str:
    for k in db.scalars(select(ApiKey).where(ApiKey.merchant_id == merchant_id, ApiKey.is_active.is_(True))).all():
        k.is_active = False
    key = "pk_live_" + secrets.token_urlsafe(24)
    db.add(ApiKey(merchant_id=merchant_id, key_hash=hash_key(key), last4=key[-4:]))
    audit(db, f"user:{merchant_id}", "apikey.rolled", f"user:{merchant_id}")
    return key


def record_api_use(db, key: ApiKey) -> None:
    now = utcnow()
    key.request_count += 1
    key.last_used_at = now
    day = now.astimezone(IST).strftime("%Y-%m-%d")
    row = db.scalar(select(ApiUsage).where(ApiUsage.merchant_id == key.merchant_id, ApiUsage.day == day))
    if row:
        row.count += 1
    else:
        db.add(ApiUsage(merchant_id=key.merchant_id, day=day, count=1))
