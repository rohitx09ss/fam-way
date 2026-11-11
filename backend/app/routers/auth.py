import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from ..audit import audit
from ..config import settings
from ..db import get_db
from ..models import MerchantSettings, User
from ..schemas import LoginIn, RegisterIn, TokenOut
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
_fails: dict[str, list[float]] = defaultdict(list)  # per-process throttle; use Redis if you scale out


def _login(db, body: LoginIn, role: str) -> TokenOut:
    key = f"{role}:{body.email.lower()}"
    now = time.time()
    _fails[key] = [t for t in _fails[key] if now - t < 600]
    if len(_fails[key]) >= 5:
        raise HTTPException(429, "Too many attempts. Try again in a few minutes.")
    user = db.scalar(select(User).where(User.email == body.email.lower(), User.role == role))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        _fails[key].append(now)
        audit(db, body.email.lower(), f"login.failed.{role}")
        db.commit()
        raise HTTPException(401, "Wrong email or password")
    _fails.pop(key, None)
    audit(db, user.email, f"login.{role}")
    db.commit()
    return TokenOut(access_token=create_token(user.id, role), role=role, email=user.email)


@router.post("/admin/login", response_model=TokenOut)
def admin_login(body: LoginIn, db=Depends(get_db)):
    return _login(db, body, "admin")


@router.post("/merchant/login", response_model=TokenOut)
def merchant_login(body: LoginIn, db=Depends(get_db)):
    return _login(db, body, "merchant")


@router.post("/merchant/register", response_model=TokenOut, status_code=201)
def merchant_register(body: RegisterIn, db=Depends(get_db)):
    if not settings.allow_signup:
        raise HTTPException(403, "Sign-up is closed. Ask the admin to create your account.")
    if db.scalar(select(User.id).where(User.email == body.email.lower())):
        raise HTTPException(409, "Email already registered")
    user = User(email=body.email.lower(), password_hash=hash_password(body.password), role="merchant",
                name=(body.name or "").strip() or None)
    db.add(user)
    db.flush()
    db.add(MerchantSettings(user_id=user.id, store_name=(body.store_name or body.name or "").strip()))
    audit(db, user.email, "merchant.registered", f"user:{user.id}")
    db.commit()
    return TokenOut(access_token=create_token(user.id, "merchant"), role="merchant", email=user.email)
