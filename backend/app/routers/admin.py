from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from ..audit import audit
from ..db import get_db
from ..deps import admin_user
from ..models import AuditLog, EmailEvent, MerchantSettings, PaymentRequest, User, PS
from ..schemas import CreateMerchantIn, UpdateMerchantIn, event_out, payment_out
from ..security import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/stats")
def stats(_=Depends(admin_user), db=Depends(get_db)):
    pay = dict(db.execute(select(PaymentRequest.status, func.count()).group_by(PaymentRequest.status)).all())
    ev = dict(db.execute(select(EmailEvent.outcome, func.count()).group_by(EmailEvent.outcome)).all())
    merchants = db.scalar(select(func.count()).select_from(User).where(User.role == "merchant")) or 0
    active = db.scalar(select(func.count()).select_from(User).where(User.role == "merchant", User.is_active.is_(True))) or 0
    verified_paise = db.scalar(select(func.coalesce(func.sum(PaymentRequest.amount_paise), 0))
                               .where(PaymentRequest.status == PS.VERIFIED)) or 0
    return {"merchants": merchants, "active_merchants": active, "payments_by_status": pay,
            "total_payments": sum(pay.values()), "events_by_outcome": ev, "verified_amount": verified_paise / 100}


@router.get("/merchants")
def merchants(_=Depends(admin_user), db=Depends(get_db)):
    users = db.scalars(select(User).where(User.role == "merchant").order_by(User.id.desc())).all()
    out = []
    for u in users:
        s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == u.id))
        n = db.scalar(select(func.count()).select_from(PaymentRequest).where(PaymentRequest.merchant_id == u.id)) or 0
        out.append({
            "id": u.id, "email": u.email, "is_active": u.is_active, "created_at": u.created_at.isoformat(),
            "store_name": s.store_name if s else "", "upi_id": s.upi_id if s else "",
            "monitoring": bool(s and s.is_enabled), "last_poll_at": s.last_poll_at.isoformat() if s and s.last_poll_at else None,
            "last_error": s.last_error if s else None, "payments": n,
        })
    return out


@router.post("/merchants", status_code=201)
def create_merchant(body: CreateMerchantIn, admin=Depends(admin_user), db=Depends(get_db)):
    if db.scalar(select(User.id).where(User.email == body.email.lower())):
        raise HTTPException(409, "Email already registered")
    u = User(email=body.email.lower(), password_hash=hash_password(body.password), role="merchant")
    db.add(u)
    db.flush()
    db.add(MerchantSettings(user_id=u.id, store_name=body.store_name))
    audit(db, admin.email, "merchant.created", f"user:{u.id}", u.email)
    db.commit()
    return {"id": u.id, "email": u.email}


@router.patch("/merchants/{uid}")
def update_merchant(uid: int, body: UpdateMerchantIn, admin=Depends(admin_user), db=Depends(get_db)):
    u = db.get(User, uid)
    if not u or u.role != "merchant":
        raise HTTPException(404, "Merchant not found")
    if body.is_active is not None:
        u.is_active = body.is_active
        audit(db, admin.email, "merchant.active_changed", f"user:{u.id}", str(body.is_active))
    if body.new_password:
        u.password_hash = hash_password(body.new_password)
        audit(db, admin.email, "merchant.password_reset", f"user:{u.id}")
    db.commit()
    return {"id": u.id, "is_active": u.is_active}


@router.get("/payments")
def payments(merchant_id: int | None = None, status: str | None = None, _=Depends(admin_user), db=Depends(get_db)):
    q = select(PaymentRequest)
    if merchant_id:
        q = q.where(PaymentRequest.merchant_id == merchant_id)
    if status:
        q = q.where(PaymentRequest.status == status)
    return [payment_out(p) for p in db.scalars(q.order_by(PaymentRequest.id.desc()).limit(300)).all()]


@router.get("/events")
def events(outcome: str | None = None, _=Depends(admin_user), db=Depends(get_db)):
    q = select(EmailEvent)
    if outcome:
        q = q.where(EmailEvent.outcome == outcome)
    return [event_out(e) for e in db.scalars(q.order_by(EmailEvent.id.desc()).limit(300)).all()]


@router.get("/audit")
def audit_log(_=Depends(admin_user), db=Depends(get_db)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(300)).all()
    return [{"id": a.id, "actor": a.actor, "action": a.action, "entity": a.entity,
             "detail": a.detail, "created_at": a.created_at.isoformat()} for a in rows]
