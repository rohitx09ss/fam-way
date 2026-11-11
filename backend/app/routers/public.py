import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from ..db import get_db
from ..models import PS, MerchantSettings, PaymentLink, PaymentRequest, STATUS_LABELS, User, utcnow
from ..qr import qr_data_url
from ..services import link_state, start_session

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


def _view(db, link: PaymentLink, cur: PaymentRequest | None, status: str) -> dict:
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == link.merchant_id))
    owner = db.get(User, link.merchant_id)
    pay = None
    if cur is not None:
        live = cur.status == PS.WAITING and cur.expires_at > utcnow()
        pay = {"reference": cur.reference, "status": cur.status, "display_status": STATUS_LABELS.get(cur.status, cur.status),
               "created_at": cur.created_at.isoformat(), "expires_at": cur.expires_at.isoformat(),
               "server_time": utcnow().isoformat(), "live": live}
        if live:
            pay["qr_data_url"] = qr_data_url(cur.upi_uri, owner.avatar_b64 if owner else None)
            pay["upi_uri"] = cur.upi_uri
    return {"slug": link.slug, "store_name": (s.store_name if s else "") or "Merchant", "amount": link.amount_paise / 100,
            "customer_name": link.customer_name, "status": status, "link_expires_at": link.expires_at.isoformat(),
            "redirect_url": link.redirect_url if status == "PAID" else None, "payment": pay,
            "support_link": (owner.support_link if owner else None) or None}


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
