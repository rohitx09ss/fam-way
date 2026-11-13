import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from ..audit import audit
from ..config import settings as cfg
from ..db import get_db
from ..deps import merchant_user
from ..gmail_client import test_connection
from ..matching import assign_event, manual_decision
from ..models import PS, EmailEvent, MerchantSettings, PaymentRequest, utcnow
from ..services import create_payment_request, logo_b64_for, resolve_active
from ..schemas import AssignIn, PaymentCreate, SettingsIn, event_out, payment_out
from ..security import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/merchant", tags=["merchant"])


def _settings(db, user) -> MerchantSettings:
    s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == user.id))
    if not s:
        s = MerchantSettings(user_id=user.id)
        db.add(s)
        db.flush()
    return s


def _settings_out(s: MerchantSettings) -> dict:
    return {
        "store_name": s.store_name, "upi_id": s.upi_id, "gmail_address": s.gmail_address,
        "has_app_password": bool(s.app_password_enc),
        "imap_host": s.imap_host, "is_enabled": s.is_enabled,
        "last_poll_at": s.last_poll_at.isoformat() if s.last_poll_at else None,
        "last_error": s.last_error,
    }


@router.get("/settings")
def get_settings(user=Depends(merchant_user), db=Depends(get_db)):
    s = _settings(db, user)
    db.commit()
    return _settings_out(s)


@router.put("/settings")
def put_settings(body: SettingsIn, user=Depends(merchant_user), db=Depends(get_db)):
    s = _settings(db, user)
    s.store_name, s.upi_id = body.store_name.strip(), body.upi_id
    s.gmail_address = body.gmail_address.strip()
    s.imap_host, s.is_enabled = body.imap_host.strip() or "imap.gmail.com", body.is_enabled
    if body.app_password:  # never echoed back; stored encrypted
        s.app_password_enc = encrypt_secret(body.app_password.replace(" ", ""))
    if s.is_enabled and not (s.gmail_address and s.app_password_enc):
        raise HTTPException(400, "Add your Gmail address and app password before turning monitoring on")
    audit(db, user.email, "settings.updated", f"user:{user.id}", "app password changed" if body.app_password else "")
    db.commit()
    return _settings_out(s)


@router.post("/settings/test-imap")
def test_imap(user=Depends(merchant_user), db=Depends(get_db)):
    s = _settings(db, user)
    if not (s.gmail_address and s.app_password_enc):
        raise HTTPException(400, "Save your Gmail address and app password first")
    ok, msg = test_connection(s.imap_host, s.gmail_address, decrypt_secret(s.app_password_enc))
    return {"ok": ok, "message": msg}


@router.post("/payments", status_code=201)
def create_payment(body: PaymentCreate, user=Depends(merchant_user), db=Depends(get_db)):
    try:
        s, account_id, upi = resolve_active(db, user.id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    paise = int((body.amount * 100).to_integral_value())
    p = create_payment_request(db, user.id, s, paise, cfg.qr_expiry_seconds, user.email, account_id=account_id, upi_id=upi)
    db.commit()
    return payment_out(p, with_qr=True, logo=logo_b64_for(db, user))


@router.get("/payments")
def list_payments(status: str | None = None, user=Depends(merchant_user), db=Depends(get_db)):
    q = select(PaymentRequest).where(PaymentRequest.merchant_id == user.id)
    if status:
        q = q.where(PaymentRequest.status == status)
    rows = db.scalars(q.order_by(PaymentRequest.id.desc()).limit(200)).all()
    return [payment_out(p) for p in rows]


def _own_payment(db, user, pid: int) -> PaymentRequest:
    p = db.get(PaymentRequest, pid)
    if not p or p.merchant_id != user.id:
        raise HTTPException(404, "Payment not found")
    return p


@router.get("/payments/{pid}")
def get_payment(pid: int, user=Depends(merchant_user), db=Depends(get_db)):
    return payment_out(_own_payment(db, user, pid), with_qr=True, logo=logo_b64_for(db, user))


@router.post("/payments/{pid}/confirm")
def confirm_payment(pid: int, user=Depends(merchant_user), db=Depends(get_db)):
    p = _own_payment(db, user, pid)
    try:
        manual_decision(db, p, True, user.email)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return payment_out(p)


@router.post("/payments/{pid}/reject")
def reject_payment(pid: int, user=Depends(merchant_user), db=Depends(get_db)):
    p = _own_payment(db, user, pid)
    try:
        manual_decision(db, p, False, user.email)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return payment_out(p)


@router.get("/stats")
def stats(user=Depends(merchant_user), db=Depends(get_db)):
    rows = db.execute(select(PaymentRequest.status, func.count(), func.coalesce(func.sum(PaymentRequest.amount_paise), 0))
                      .where(PaymentRequest.merchant_id == user.id).group_by(PaymentRequest.status)).all()
    by = {r[0]: {"count": r[1], "amount": r[2] / 100} for r in rows}
    c = lambda *ss: sum(by.get(s, {}).get("count", 0) for s in ss)
    return {
        "total": c(*by.keys()),
        "pending": c(PS.CREATED, PS.WAITING),
        "detected": c(PS.DETECTED, PS.VERIFYING),
        "verified": c(PS.VERIFIED),
        "verified_amount": by.get(PS.VERIFIED, {}).get("amount", 0),
        "expired": c(PS.EXPIRED),
        "failed": c(PS.FAILED),
        "review": c(PS.REVIEW),
    }


@router.get("/events")
def events(user=Depends(merchant_user), db=Depends(get_db)):
    rows = db.scalars(select(EmailEvent).where(EmailEvent.merchant_id == user.id)
                      .order_by(EmailEvent.id.desc()).limit(200)).all()
    return [event_out(e) for e in rows]


@router.post("/events/{eid}/assign")
def assign(eid: int, body: AssignIn, user=Depends(merchant_user), db=Depends(get_db)):
    ev = db.get(EmailEvent, eid)
    p = db.get(PaymentRequest, body.payment_id)
    if not ev or ev.merchant_id != user.id or not p or p.merchant_id != user.id:
        raise HTTPException(404, "Not found")
    try:
        assign_event(db, ev, p, user.email)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"event": event_out(ev), "payment": payment_out(p)}
