from datetime import datetime, timezone

from sqlalchemy import (Boolean, DateTime, ForeignKey, Integer, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UtcDateTime(TypeDecorator):
    """Always store/return timezone-aware UTC (SQLite drops tzinfo)."""
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class PS:  # payment request states
    CREATED = "CREATED"
    WAITING = "WAITING_FOR_PAYMENT"
    DETECTED = "PAYMENT_DETECTED"
    VERIFYING = "VERIFYING"
    VERIFIED = "VERIFIED"
    EXPIRED = "EXPIRED"
    FAILED = "FAILED"
    REVIEW = "REVIEW_REQUIRED"


STATUS_LABELS = {
    PS.CREATED: "Created",
    PS.WAITING: "Waiting for payment",
    PS.DETECTED: "PAYMENT DETECTED — VERIFICATION PENDING",
    PS.VERIFYING: "Verifying",
    PS.VERIFIED: "Payment verified",
    PS.EXPIRED: "Expired",
    PS.FAILED: "Verification failed",
    PS.REVIEW: "Review required",
}


class EO:  # email event outcomes
    MATCHED = "MATCHED"
    DUPLICATE = "DUPLICATE"
    REJECTED = "REJECTED"
    MISMATCH = "MISMATCH"
    AMBIGUOUS = "AMBIGUOUS"
    LATE = "LATE"
    UNMATCHED = "UNMATCHED"
    REVIEW = "REVIEW"
    MANUAL = "MANUALLY_ASSIGNED"


REVIEWABLE = (EO.AMBIGUOUS, EO.LATE, EO.UNMATCHED, EO.REVIEW)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), index=True)  # admin | merchant
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class MerchantSettings(Base):
    __tablename__ = "merchant_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    store_name: Mapped[str] = mapped_column(String(120), default="")
    upi_id: Mapped[str] = mapped_column(String(120), default="")
    gmail_address: Mapped[str] = mapped_column(String(255), default="")
    app_password_enc: Mapped[str] = mapped_column(Text, default="")
    imap_host: Mapped[str] = mapped_column(String(120), default="imap.gmail.com")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_poll_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class PaymentRequest(Base):
    __tablename__ = "payment_requests"
    __table_args__ = (UniqueConstraint("merchant_id", "transaction_id", name="uq_pay_txn"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reference: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    merchant_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), index=True, default=PS.CREATED)
    upi_uri: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    detected_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    utr: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verification_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class EmailEvent(Base):
    __tablename__ = "email_events"
    __table_args__ = (
        UniqueConstraint("merchant_id", "message_id", name="uq_event_msg"),
        UniqueConstraint("merchant_id", "transaction_id", name="uq_event_txn"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    merchant_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sender: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transaction_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String(32), nullable=True)
    payer_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    utr: Mapped[str | None] = mapped_column(String(64), nullable=True)
    txn_time: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    auth_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    outcome: Mapped[str] = mapped_column(String(30), index=True)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payment_requests.id"), nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor: Mapped[str] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity: Mapped[str] = mapped_column(String(80), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
