from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from ..db import get_db
from ..models import ApiKey, MerchantSettings, PaymentLink, User
from ..services import create_link, hash_key, link_state, pay_url, record_api_use, resolve_active

router = APIRouter(prefix="/api/v1", tags=["merchant API (Bearer key)"])
bearer = HTTPBearer(auto_error=False)


def api_merchant(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db=Depends(get_db)) -> User:
    if not creds:
        raise HTTPException(401, "Missing API key. Send header: Authorization: Bearer <key>")
    key = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_key(creds.credentials), ApiKey.is_active.is_(True)))
    user = db.get(User, key.merchant_id) if key else None
    if not key or not user or not user.is_active:
        raise HTTPException(401, "Invalid or revoked API key")
    record_api_use(db, key)
    db.commit()
    return user


class OrderIn(BaseModel):
    amount: Decimal = Field(gt=0, le=100000, decimal_places=2)
    customer_name: str | None = Field(default=None, max_length=100)
    order_id: str | None = Field(default=None, max_length=100, description="Your own order reference")
    redirect_url: str | None = Field(default=None, max_length=500, description="Where the customer returns after paying")
    expires_in_minutes: int = Field(default=30, ge=1, le=1440)

    @field_validator("redirect_url")
    @classmethod
    def _url(cls, v):
        if v and not v.lower().startswith(("http://", "https://")):
            raise ValueError("redirect_url must start with http:// or https://")
        return v


def order_out(db, link: PaymentLink) -> dict:
    st, cur, _ = link_state(db, link)
    paid = cur if st == "PAID" else None
    return {
        "order": link.slug, "order_id": link.order_id, "amount": link.amount_paise / 100, "currency": "INR",
        "status": st, "pay_url": pay_url(link.slug), "expires_at": link.expires_at.isoformat(),
        "customer_name": link.customer_name,
        "transaction_id": paid.transaction_id if paid else None, "utr": paid.utr if paid else None,
        "payer_name": paid.payer_name if paid else None,
        "verified_at": paid.verified_at.isoformat() if paid and paid.verified_at else None,
    }


@router.post("/orders", status_code=201)
def create_order(body: OrderIn, user=Depends(api_merchant), db=Depends(get_db)):
    """Create a payment order. Send the customer to `pay_url`; poll GET /orders/{order} or use webhooks."""
    try:
        resolve_active(db, user.id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    link = create_link(db, user.id, int((body.amount * 100).to_integral_value()), body.expires_in_minutes * 60,
                       body.customer_name, body.order_id, body.redirect_url, source="api")
    db.commit()
    return order_out(db, link)


@router.get("/orders/{slug}")
def get_order(slug: str, user=Depends(api_merchant), db=Depends(get_db)):
    link = db.scalar(select(PaymentLink).where(PaymentLink.slug == slug, PaymentLink.merchant_id == user.id))
    if not link:
        raise HTTPException(404, "Order not found")
    return order_out(db, link)
