from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import get_db
from .models import User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


def _require(role: str):
    def dep(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db=Depends(get_db)) -> User:
        if not creds:
            raise HTTPException(401, "Not authenticated")
        try:
            payload = decode_token(creds.credentials)
        except Exception:
            raise HTTPException(401, "Invalid or expired token")
        user = db.get(User, int(payload.get("sub", 0)))
        if not user or not user.is_active or user.role != role or payload.get("role") != role:
            raise HTTPException(403, "Not allowed")
        return user
    return dep


admin_user = _require("admin")
merchant_user = _require("merchant")
