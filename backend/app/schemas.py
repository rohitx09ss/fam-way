import re
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, field_validator

from .models import STATUS_LABELS, REVIEWABLE, EmailEvent, PaymentRequest, utcnow
from .qr import qr_data_url


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    store_name: str = Field(default="", max_length=120)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    email: str


class PaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0, le=100000, decimal_places=2)


class SettingsIn(BaseModel):
    store_name: str = Field(default="", max_length=120)
    upi_id: str = Field(default="", max_length=120)
    gmail_address: str = Field(default="", max_length=255)
    app_password: str | None = Field(default=None, max_length=100)  # omit to keep the saved one
    imap_host: str = Field(default="imap.gmail.com", max_length=120)
    is_enabled: bool = False

    @field_validator("upi_id")
    @classmethod
    def _upi(cls, v: str) -> str:
        v = v.strip()
        if v and not re.fullmatch(r"[\w.\-]{2,}@[A-Za-z0-9]{2,}", v):
            raise ValueError("UPI ID looks invalid (example: name@bank)")
        return v


class AssignIn(BaseModel):
    payment_id: int


class NotificationIn(BaseModel):
    source: str = "fampay"
    amount: Decimal = Field(gt=0, decimal_places=2)
    transaction_id: str = Field(min_length=4, max_length=64)
    payment_reference: str | None = None
    timestamp: datetime
    merchant_id: int | None = None
    payer_name: str | None = Field(default=None, max_length=120)
    utr: str | None = Field(default=None, max_length=64)


class CreateMerchantIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    store_name: str = Field(default="", max_length=120)


class UpdateMerchantIn(BaseModel):
    is_active: bool | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=200)


def payment_out(p: PaymentRequest, with_qr: bool = False) -> dict:
    d = {
        "id": p.id, "reference": p.reference, "merchant_id": p.merchant_id,
        "amount": p.amount_paise / 100, "status": p.status,
        "display_status": STATUS_LABELS.get(p.status, p.status),
        "created_at": p.created_at.isoformat(), "expires_at": p.expires_at.isoformat(),
        "detected_at": p.detected_at.isoformat() if p.detected_at else None,
        "verified_at": p.verified_at.isoformat() if p.verified_at else None,
        "transaction_id": p.transaction_id, "payer_name": p.payer_name, "utr": p.utr,
        "verification_note": p.verification_note,
        "server_time": utcnow().isoformat(),
    }
    if with_qr:
        d["qr_data_url"] = qr_data_url(p.upi_uri)
    return d


def event_out(e: EmailEvent) -> dict:
    return {
        "id": e.id, "merchant_id": e.merchant_id, "sender": e.sender, "subject": e.subject,
        "amount": (e.amount_paise or 0) / 100, "transaction_id": e.transaction_id,
        "payment_reference": e.payment_reference, "payer_name": e.payer_name, "utr": e.utr, "payment_id": e.payment_id,
        "txn_time": e.txn_time.isoformat() if e.txn_time else None,
        "auth_ok": e.auth_ok, "outcome": e.outcome, "detail": e.detail,
        "created_at": e.created_at.isoformat(),
        "reviewable": e.outcome in REVIEWABLE and bool(e.transaction_id),
    }
