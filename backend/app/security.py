import base64
import hashlib
import logging
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from cryptography.fernet import Fernet

from .config import settings

log = logging.getLogger(__name__)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], hashed.encode())
    except ValueError:
        return False


def create_token(user_id: int, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": str(user_id), "role": role, "exp": exp}, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def _fernet() -> Fernet:
    key = settings.encryption_key
    if not key:
        log.warning("ENCRYPTION_KEY not set: deriving a dev key from JWT_SECRET. Set a real key in production.")
        key = base64.urlsafe_b64encode(hashlib.sha256(settings.jwt_secret.encode()).digest()).decode()
    return Fernet(key.encode())


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode() if token else ""
