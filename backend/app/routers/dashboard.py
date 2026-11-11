from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from ..audit import audit
from ..db import get_db
from ..deps import merchant_user
from ..models import (PS, ApiKey, ApiUsage, MerchantSettings, PaymentLink, PaymentRequest, User,
                      WebhookDelivery, WebhookEndpoint)
from ..schemas import payment_out
from ..security import decrypt_secret, encrypt_secret, hash_password, verify_password
from ..gmail_client import test_connection
from ..models import ReceivingAccount
from ..qr import process_avatar
from pydantic import EmailStr
from ..services import (EXPIRY, IST, create_link, link_state, merchant_code, pay_url, resolve_active, roll_api_key)
from ..webhooks import enqueue_test, ensure_secret, validate_url

router = APIRouter(prefix="/merchant", tags=["merchant-dashboard"])
UTC = timezone.utc
GROUPS = {
    "captured": [PS.VERIFIED],
    "created": [PS.CREATED, PS.WAITING, PS.DETECTED, PS.VERIFYING],
    "expired": [PS.EXPIRED],
    "failed": [PS.FAILED, PS.REVIEW],
}


def _today_ist() -> datetime:
    return datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)


def _bounds(name: str):
    today, day = _today_ist(), timedelta(days=1)
    if name == "lastmonth":
        first = today.replace(day=1)
        return (first - day).replace(day=1).astimezone(UTC), first.astimezone(UTC)
    table = {"today": (today, today + day), "yesterday": (today - day, today),
             "7d": (today - 6 * day, today + day), "30d": (today - 29 * day, today + day),
             "month": (today.replace(day=1), today + day)}
    if name in table:
        s, e = table[name]
        return s.astimezone(UTC), e.astimezone(UTC)
    return None, None


# ---------------- profile ----------------
class ProfileIn(BaseModel):
    name: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=20)
    store_name: str = Field(default="", max_length=120)
    support_link: str = Field(default="", max_length=300)


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


def _me(db, user: User) -> dict:
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == user.id))
    return {"id": user.id, "merchant_id": merchant_code(user.id), "email": user.email, "name": user.name or "",
            "phone": user.phone or "", "store_name": (s.store_name if s else "") or "",
            "support_link": user.support_link or "",
            "avatar": ("data:image/png;base64," + user.avatar_b64) if user.avatar_b64 else None,
            "created_at": user.created_at.isoformat()}


@router.get("/me")
def me(user=Depends(merchant_user), db=Depends(get_db)):
    return _me(db, user)


@router.put("/profile")
def update_profile(body: ProfileIn, user=Depends(merchant_user), db=Depends(get_db)):
    link = body.support_link.strip()
    if link and not link.lower().startswith(("http://", "https://", "mailto:", "tel:")):
        raise HTTPException(422, "Support link must start with https://, mailto: or tel:")
    user.name, user.phone, user.support_link = body.name.strip(), body.phone.strip(), (link or None)
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == user.id))
    if not s:
        s = MerchantSettings(user_id=user.id)
        db.add(s)
    s.store_name = body.store_name.strip()
    audit(db, user.email, "profile.updated", f"user:{user.id}")
    db.commit()
    return _me(db, user)


@router.post("/password")
def change_password(body: PasswordIn, user=Depends(merchant_user), db=Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is wrong")
    user.password_hash = hash_password(body.new_password)
    audit(db, user.email, "password.changed", f"user:{user.id}")
    db.commit()
    return {"ok": True}


# ---------------- overview + transactions ----------------
@router.get("/overview")
def overview(days: int = Query(7), user=Depends(merchant_user), db=Depends(get_db)):
    days = days if days in (7, 15, 30) else 7
    start = _today_ist() - timedelta(days=days - 1)
    series = {(start + timedelta(days=i)).strftime("%Y-%m-%d"): {"date": (start + timedelta(days=i)).strftime("%Y-%m-%d"),
                                                                    "revenue": 0.0, "requests": 0} for i in range(days)}
    for p in db.scalars(select(PaymentRequest).where(PaymentRequest.merchant_id == user.id,
                                                      PaymentRequest.created_at >= start.astimezone(UTC))).all():
        row = series.get(p.created_at.astimezone(IST).strftime("%Y-%m-%d"))
        if row:
            row["requests"] += 1
            if p.status == PS.VERIFIED:
                row["revenue"] += p.amount_paise / 100
    agg = db.execute(select(PaymentRequest.status, func.count(), func.coalesce(func.sum(PaymentRequest.amount_paise), 0))
                     .where(PaymentRequest.merchant_id == user.id).group_by(PaymentRequest.status)).all()
    total = sum(r[1] for r in agg)
    ok = sum(r[1] for r in agg if r[0] == PS.VERIFIED)
    revenue = sum(r[2] for r in agg if r[0] == PS.VERIFIED) / 100
    recent = db.scalars(select(PaymentRequest).where(PaymentRequest.merchant_id == user.id)
                        .order_by(PaymentRequest.id.desc()).limit(8)).all()
    return {"revenue": revenue, "total": total, "successful": ok, "other": total - ok,
            "series": list(series.values()), "recent": [payment_out(p) for p in recent]}


@router.get("/transactions")
def transactions(status: str = "all", range: str = "all", q: str = "", page: int = 1, limit: int = 10,
                 user=Depends(merchant_user), db=Depends(get_db)):
    limit = limit if limit in (10, 25, 50) else 10
    s, e = _bounds(range)
    base = [PaymentRequest.merchant_id == user.id]
    if s:
        base += [PaymentRequest.created_at >= s, PaymentRequest.created_at < e]
    # summary for the chosen date range (not narrowed by status/search)
    agg = db.execute(select(PaymentRequest.status, func.count(), func.coalesce(func.sum(PaymentRequest.amount_paise), 0))
                     .where(*base).group_by(PaymentRequest.status)).all()
    def cnt(group): return sum(r[1] for r in agg if r[0] in GROUPS[group])
    summary = {"collected": sum(r[2] for r in agg if r[0] == PS.VERIFIED) / 100, "captured": cnt("captured"),
               "pending": cnt("created"), "expired": cnt("expired"), "failed": cnt("failed")}
    filt = list(base)
    if status in GROUPS:
        filt.append(PaymentRequest.status.in_(GROUPS[status]))
    q = q.strip()[:60]
    if q:
        like = f"%{q}%"
        filt.append(or_(PaymentRequest.reference.ilike(like), PaymentRequest.transaction_id.ilike(like),
                        PaymentRequest.utr.ilike(like), PaymentRequest.payer_name.ilike(like),
                        PaymentRequest.customer_name.ilike(like)))
    total = db.scalar(select(func.count()).select_from(PaymentRequest).where(*filt)) or 0
    pages = max(1, -(-total // limit))
    page = min(max(1, page), pages)
    rows = db.scalars(select(PaymentRequest).where(*filt).order_by(PaymentRequest.id.desc())
                      .offset((page - 1) * limit).limit(limit)).all()
    return {"items": [payment_out(p) for p in rows], "total": total, "page": page, "pages": pages, "summary": summary}


# ---------------- payment links ----------------
class LinkIn(BaseModel):
    amount: Decimal = Field(gt=0, le=100000, decimal_places=2)
    customer_name: str | None = Field(default=None, max_length=100)
    expiry: str = "24h"


def link_out(db, link: PaymentLink) -> dict:
    st, cur, _ = link_state(db, link)
    paid = cur if st == "PAID" else None
    return {"slug": link.slug, "url": pay_url(link.slug), "amount": link.amount_paise / 100, "status": st,
            "customer_name": link.customer_name, "order_id": link.order_id, "source": link.source,
            "created_at": link.created_at.isoformat(), "expires_at": link.expires_at.isoformat(),
            "transaction_id": paid.transaction_id if paid else None, "payer_name": paid.payer_name if paid else None}


@router.post("/links", status_code=201)
def make_link(body: LinkIn, user=Depends(merchant_user), db=Depends(get_db)):
    try:
        resolve_active(db, user.id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if body.expiry not in EXPIRY:
        raise HTTPException(422, "Invalid expiry")
    link = create_link(db, user.id, int((body.amount * 100).to_integral_value()), EXPIRY[body.expiry],
                       (body.customer_name or "").strip() or None)
    db.commit()
    return link_out(db, link)


@router.get("/links")
def list_links(user=Depends(merchant_user), db=Depends(get_db)):
    rows = db.scalars(select(PaymentLink).where(PaymentLink.merchant_id == user.id)
                      .order_by(PaymentLink.id.desc()).limit(100)).all()
    return [link_out(db, l) for l in rows]


# ---------------- API keys ----------------
@router.get("/api-keys")
def list_keys(user=Depends(merchant_user), db=Depends(get_db)):
    rows = db.scalars(select(ApiKey).where(ApiKey.merchant_id == user.id, ApiKey.is_active.is_(True))
                      .order_by(ApiKey.id.desc())).all()
    return [{"id": k.id, "name": k.name, "masked": "pk_live_" + "•" * 24 + k.last4, "last4": k.last4,
             "request_count": k.request_count, "created_at": k.created_at.isoformat(),
             "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None} for k in rows]


@router.post("/api-keys/roll")
def roll_key(user=Depends(merchant_user), db=Depends(get_db)):
    """Creates a new key and revokes the old one. The full key is returned ONCE and never stored."""
    key = roll_api_key(db, user.id)
    db.commit()
    return {"key": key}


@router.get("/api-usage")
def api_usage(days: int = Query(7), user=Depends(merchant_user), db=Depends(get_db)):
    days = days if days in (7, 14, 30) else 7
    start = _today_ist() - timedelta(days=days - 1)
    rows = {r.day: r.count for r in db.scalars(select(ApiUsage).where(
        ApiUsage.merchant_id == user.id, ApiUsage.day >= start.strftime("%Y-%m-%d"))).all()}
    series = [{"date": (start + timedelta(days=i)).strftime("%Y-%m-%d"),
               "count": rows.get((start + timedelta(days=i)).strftime("%Y-%m-%d"), 0)} for i in range(days)]
    counts = [x["count"] for x in series]
    return {"series": series, "total": sum(counts), "average": round(sum(counts) / days, 1), "peak": max(counts)}


# ---------------- webhooks ----------------
class EndpointIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=8, max_length=500)


def _ep_out(e: WebhookEndpoint) -> dict:
    return {"id": e.id, "name": e.name, "url": e.url, "is_active": e.is_active, "created_at": e.created_at.isoformat()}


@router.get("/webhooks")
def list_endpoints(user=Depends(merchant_user), db=Depends(get_db)):
    secret = ensure_secret(db, user)
    db.commit()
    rows = db.scalars(select(WebhookEndpoint).where(WebhookEndpoint.merchant_id == user.id)
                      .order_by(WebhookEndpoint.id.desc())).all()
    return {"endpoints": [_ep_out(e) for e in rows], "secret": secret}


@router.post("/webhooks", status_code=201)
def add_endpoint(body: EndpointIn, user=Depends(merchant_user), db=Depends(get_db)):
    count = db.scalar(select(func.count()).select_from(WebhookEndpoint).where(WebhookEndpoint.merchant_id == user.id)) or 0
    if count >= 5:
        raise HTTPException(400, "You can add up to 5 webhook endpoints")
    try:
        validate_url(body.url.strip())
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    ensure_secret(db, user)
    e = WebhookEndpoint(merchant_id=user.id, name=body.name.strip(), url=body.url.strip())
    db.add(e)
    audit(db, user.email, "webhook.added", f"user:{user.id}", body.url[:200])
    db.commit()
    return _ep_out(e)


def _own_endpoint(db, user, eid: int) -> WebhookEndpoint:
    e = db.get(WebhookEndpoint, eid)
    if not e or e.merchant_id != user.id:
        raise HTTPException(404, "Endpoint not found")
    return e


@router.delete("/webhooks/{eid}")
def delete_endpoint(eid: int, user=Depends(merchant_user), db=Depends(get_db)):
    e = _own_endpoint(db, user, eid)
    for d in db.scalars(select(WebhookDelivery).where(WebhookDelivery.endpoint_id == e.id)).all():
        db.delete(d)
    db.delete(e)
    audit(db, user.email, "webhook.deleted", f"user:{user.id}")
    db.commit()
    return {"ok": True}


@router.post("/webhooks/{eid}/test")
def test_endpoint(eid: int, user=Depends(merchant_user), db=Depends(get_db)):
    e = _own_endpoint(db, user, eid)
    enqueue_test(db, user.id, e.id)
    db.commit()
    return {"queued": True}


@router.get("/webhook-deliveries")
def deliveries(filter: str = "all", page: int = 1, user=Depends(merchant_user), db=Depends(get_db)):
    base = [WebhookDelivery.merchant_id == user.id]
    counts = dict(db.execute(select(WebhookDelivery.status, func.count()).where(*base)
                             .group_by(WebhookDelivery.status)).all())
    flt = list(base)
    if filter == "success":
        flt.append(WebhookDelivery.status == "SUCCESS")
    elif filter == "failed":
        flt.append(WebhookDelivery.status.in_(["FAILED", "PENDING"]))
        flt.append(WebhookDelivery.attempts > 0)
    total = db.scalar(select(func.count()).select_from(WebhookDelivery).where(*flt)) or 0
    per = 20
    pages = max(1, -(-total // per))
    page = min(max(1, page), pages)
    rows = db.scalars(select(WebhookDelivery).where(*flt).order_by(WebhookDelivery.id.desc())
                      .offset((page - 1) * per).limit(per)).all()
    names = {e.id: e.name for e in db.scalars(select(WebhookEndpoint).where(WebhookEndpoint.merchant_id == user.id)).all()}
    return {"items": [{"id": d.id, "endpoint": names.get(d.endpoint_id, "(deleted)"), "event": d.event, "status": d.status,
                       "attempts": d.attempts, "response_code": d.response_code, "response_body": d.response_body,
                       "payload": d.payload, "created_at": d.created_at.isoformat()} for d in rows],
            "total": total, "page": page, "pages": pages,
            "counts": {"all": sum(counts.values()), "success": counts.get("SUCCESS", 0),
                       "failed": counts.get("FAILED", 0)}}


# ---------------- QR avatar ----------------
class AvatarIn(BaseModel):
    image: str


@router.post("/avatar")
def set_avatar(body: AvatarIn, user=Depends(merchant_user), db=Depends(get_db)):
    try:
        user.avatar_b64 = process_avatar(body.image)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    audit(db, user.email, "avatar.set", f"user:{user.id}")
    db.commit()
    return _me(db, user)


@router.delete("/avatar")
def clear_avatar(user=Depends(merchant_user), db=Depends(get_db)):
    user.avatar_b64 = None
    db.commit()
    return _me(db, user)


# ---------------- payment alerts (sound / notification polling) ----------------
@router.get("/alerts")
def alerts(since: str = "", user=Depends(merchant_user), db=Depends(get_db)):
    try:
        t = datetime.fromisoformat(since.replace("Z", "+00:00"))
        t = t if t.tzinfo else t.replace(tzinfo=UTC)
    except ValueError:
        t = datetime.now(UTC) - timedelta(seconds=30)
    now = datetime.now(UTC)
    rows = db.scalars(select(PaymentRequest).where(
        PaymentRequest.merchant_id == user.id, PaymentRequest.verified_at.is_not(None),
        PaymentRequest.verified_at > t).order_by(PaymentRequest.verified_at).limit(20)).all()
    return {"now": now.isoformat(), "items": [{"id": p.id, "amount": p.amount_paise / 100, "payer_name": p.payer_name,
                                               "verified_at": p.verified_at.isoformat()} for p in rows]}


# ---------------- multiple receiving accounts ----------------
MAX_ACCOUNTS = 5
UPI_RE = __import__("re").compile(r"[\w.\-]{2,}@[A-Za-z0-9]{2,}")


class AccountIn(BaseModel):
    label: str = Field(default="", max_length=60)
    upi_id: str = Field(min_length=3, max_length=120)
    gmail_address: EmailStr
    app_password: str | None = Field(default=None, max_length=100)


def _acc_out(a: ReceivingAccount, active_id: int | None) -> dict:
    return {"id": a.id, "label": a.label or "Standby account", "upi_id": a.upi_id, "gmail_address": a.gmail_address,
            "has_app_password": bool(a.app_password_enc), "is_enabled": a.is_enabled,
            "last_poll_at": a.last_poll_at.isoformat() if a.last_poll_at else None, "last_error": a.last_error,
            "is_active": active_id == a.id}


def _own_account(db, user, aid: int) -> ReceivingAccount:
    a = db.get(ReceivingAccount, aid)
    if not a or a.merchant_id != user.id:
        raise HTTPException(404, "Account not found")
    return a


def _check_unique(db, user, s, upi: str, gmail: str, ignore_id: int | None = None):
    others = db.scalars(select(ReceivingAccount).where(ReceivingAccount.merchant_id == user.id)).all()
    used_upi = {x.upi_id.lower() for x in others if x.id != ignore_id} | ({s.upi_id.lower()} if s.upi_id else set())
    used_mail = {x.gmail_address.lower() for x in others if x.id != ignore_id} | ({s.gmail_address.lower()} if s.gmail_address else set())
    if upi.lower() in used_upi:
        raise HTTPException(409, "That UPI ID is already linked to another account")
    if gmail.lower() in used_mail:
        raise HTTPException(409, "That Gmail inbox is already linked to another account")


@router.get("/accounts")
def accounts(user=Depends(merchant_user), db=Depends(get_db)):
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == user.id))
    rows = db.scalars(select(ReceivingAccount).where(ReceivingAccount.merchant_id == user.id).order_by(ReceivingAccount.id)).all()
    active = s.active_account_id if s else None
    primary = {"id": "primary", "label": "Primary account", "upi_id": s.upi_id if s else "", "gmail_address": s.gmail_address if s else "",
               "has_app_password": bool(s and s.app_password_enc), "is_enabled": bool(s and s.is_enabled),
               "last_poll_at": s.last_poll_at.isoformat() if s and s.last_poll_at else None,
               "last_error": s.last_error if s else None, "is_active": active is None}
    return {"primary": primary, "standby": [_acc_out(a, active) for a in rows], "max": MAX_ACCOUNTS}


@router.post("/accounts", status_code=201)
def add_account(body: AccountIn, user=Depends(merchant_user), db=Depends(get_db)):
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == user.id))
    count = db.scalar(select(func.count()).select_from(ReceivingAccount).where(ReceivingAccount.merchant_id == user.id)) or 0
    if count + 1 >= MAX_ACCOUNTS:
        raise HTTPException(400, f"You can link up to {MAX_ACCOUNTS} accounts in total")
    if not UPI_RE.fullmatch(body.upi_id.strip()):
        raise HTTPException(422, "UPI ID looks invalid (example: name@fam)")
    if not body.app_password:
        raise HTTPException(422, "Google app password is required")
    _check_unique(db, user, s or MerchantSettings(), body.upi_id.strip(), body.gmail_address)
    a = ReceivingAccount(merchant_id=user.id, label=body.label.strip(), upi_id=body.upi_id.strip(), gmail_address=body.gmail_address.strip(),
                         app_password_enc=encrypt_secret(body.app_password.replace(" ", "")), is_enabled=True)
    db.add(a)
    audit(db, user.email, "account.added", f"user:{user.id}", a.upi_id)
    db.commit()
    return _acc_out(a, s.active_account_id if s else None)


@router.put("/accounts/{aid}")
def edit_account(aid: int, body: AccountIn, user=Depends(merchant_user), db=Depends(get_db)):
    a = _own_account(db, user, aid)
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == user.id))
    if not UPI_RE.fullmatch(body.upi_id.strip()):
        raise HTTPException(422, "UPI ID looks invalid (example: name@fam)")
    _check_unique(db, user, s or MerchantSettings(), body.upi_id.strip(), body.gmail_address, ignore_id=a.id)
    a.label, a.upi_id, a.gmail_address = body.label.strip(), body.upi_id.strip(), body.gmail_address.strip()
    if body.app_password:
        a.app_password_enc = encrypt_secret(body.app_password.replace(" ", ""))
        a.is_enabled = True
    audit(db, user.email, "account.edited", f"user:{user.id}", a.upi_id)
    db.commit()
    return _acc_out(a, s.active_account_id if s else None)


@router.delete("/accounts/{aid}")
def delete_account(aid: int, user=Depends(merchant_user), db=Depends(get_db)):
    a = _own_account(db, user, aid)
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == user.id))
    if s and s.active_account_id == a.id:
        s.active_account_id = None  # fall back to primary
    db.delete(a)
    audit(db, user.email, "account.deleted", f"user:{user.id}", a.upi_id)
    db.commit()
    return {"ok": True}


@router.post("/accounts/{ident}/activate")
def activate_account(ident: str, user=Depends(merchant_user), db=Depends(get_db)):
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == user.id))
    if not s:
        raise HTTPException(400, "Set up your primary account first")
    if ident == "primary":
        if not s.upi_id:
            raise HTTPException(400, "Primary account has no UPI ID yet")
        s.active_account_id = None
    else:
        a = _own_account(db, user, int(ident))
        s.active_account_id = a.id
    audit(db, user.email, "account.activated", f"user:{user.id}", ident)
    db.commit()
    return {"active": ident}


@router.post("/accounts/{aid}/disconnect")
def disconnect_account(aid: int, user=Depends(merchant_user), db=Depends(get_db)):
    a = _own_account(db, user, aid)
    a.is_enabled, a.app_password_enc = False, ""
    audit(db, user.email, "account.disconnected", f"user:{user.id}", a.upi_id)
    db.commit()
    return _acc_out(a, None)


@router.post("/accounts/{aid}/test")
def test_account(aid: int, user=Depends(merchant_user), db=Depends(get_db)):
    a = _own_account(db, user, aid)
    if not a.app_password_enc:
        raise HTTPException(400, "No app password saved for this account")
    ok, msg = test_connection(a.imap_host, a.gmail_address, decrypt_secret(a.app_password_enc))
    return {"ok": ok, "message": msg}
