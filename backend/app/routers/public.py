import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from ..db import get_db
from ..models import PS, MerchantSettings, PaymentLink, PaymentRequest, STATUS_LABELS, User, utcnow
from ..qr import qr_data_url
from ..services import link_state, logo_b64_for, start_session, wa_link

router = APIRouter(prefix="/public", tags=["public checkout"])
_hits: dict[str, list[float]] = defaultdict(list)  # per-process; use Redis if you scale out


def _throttle(request: Request, limit: int = 12) -> None:
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?")
    now = time.time()
    _hits[ip] = [t for t in _hits[ip] if now - t < 60]
    if len(_hits[ip]) >= limit:
        raise HTTPException(429, "Too many requests. Please wait a minute.")
    _hits[ip].append(now)


def _get_link(db, slug: str) -> PaymentLink:
    link = db.scalar(select(PaymentLink).where(PaymentLink.slug == slug))
    if not link:
        raise HTTPException(404, "Payment link not found")
    return link


def _paid(cur: PaymentRequest) -> dict:
    ref = cur.utr or cur.transaction_id or ""
    return {"ref": ("••••" + ref[-4:]) if len(ref) > 4 else ref, "paid_at": cur.verified_at.isoformat() if cur.verified_at else None}


def _view(db, link: PaymentLink, cur: PaymentRequest | None, status: str) -> dict:
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == link.merchant_id))
    owner = db.get(User, link.merchant_id)
    logo = logo_b64_for(db, owner)
    pay = None
    if cur is not None:
        live = cur.status == PS.WAITING and cur.expires_at > utcnow()
        pay = {"reference": cur.reference, "status": cur.status, "display_status": STATUS_LABELS.get(cur.status, cur.status),
               "created_at": cur.created_at.isoformat(), "expires_at": cur.expires_at.isoformat(),
               "server_time": utcnow().isoformat(), "live": live}
        if live:
            pay["qr_data_url"] = qr_data_url(cur.upi_uri, logo)
            pay["upi_uri"] = cur.upi_uri
    return {"slug": link.slug, "store_name": (s.store_name if s else "") or "Merchant", "amount": link.amount_paise / 100,
            "customer_name": link.customer_name, "status": status, "link_expires_at": link.expires_at.isoformat(),
            "redirect_url": link.redirect_url if status == "PAID" else None, "payment": pay,
            "support_link": (wa_link(owner.whatsapp, link.slug) if owner and owner.whatsapp else (owner.support_link if owner else None)) or None,
            "theme": (owner.checkout_theme if owner and owner.checkout_theme in (1, 2, 3) else 1),
            "logo": ("data:image/png;base64," + logo) if logo else None,
            "paid": _paid(cur) if status == "PAID" and cur else None}


@router.get("/links/{slug}")
def link_info(slug: str, db=Depends(get_db)):
    link = _get_link(db, slug)
    st, cur, _ = link_state(db, link)
    return _view(db, link, cur, st)


@router.post("/links/{slug}/session")
def link_session(slug: str, request: Request, db=Depends(get_db)):
    _throttle(request)
    link = _get_link(db, slug)
    try:
        st, cur = start_session(db, link)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _view(db, link, cur, st)


@router.get("/sample-qr")
def sample_qr(logo: str = "none"):
    """Demo QR (not a real payment) so merchants can preview logos."""
    from ..logos import PRESETS, preset_b64
    b64 = preset_b64(logo[7:] if logo.startswith("preset:") else logo, "M") if (logo.replace("preset:", "") in PRESETS) else None
    return {"qr": qr_data_url("upi://pay?pa=demo@fam&pn=Demo&am=1.00&cu=INR", b64)}
