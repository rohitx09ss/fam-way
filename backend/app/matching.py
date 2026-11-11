"""Payment matching engine. All timing decisions use SERVER-side timestamps."""
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select

from .audit import audit
from .config import settings
from .models import EO, PS, EmailEvent, PaymentRequest, utcnow
from .webhooks import enqueue as enqueue_webhook
from .verification import NullAdapter, VerificationResult, get_adapter

log = logging.getLogger(__name__)
OPEN = (PS.CREATED, PS.WAITING)
BUSY = (PS.VERIFIED, PS.DETECTED, PS.VERIFYING)


@dataclass
class Notification:
    merchant_id: int
    amount_paise: int
    transaction_id: str | None
    timestamp: datetime
    payment_reference: str | None = None
    source: str = "fampay"
    message_id: str | None = None
    sender: str | None = None
    subject: str | None = None
    auth_ok: bool = True
    payer_name: str | None = None
    utr: str | None = None
    auth_note: str = ""
    account_id: int | None = None  # which receiving account's inbox the email came from (None = primary)


def expire_due(db, now: datetime | None = None) -> int:
    now = now or utcnow()
    rows = db.scalars(select(PaymentRequest).where(
        PaymentRequest.status.in_(OPEN), PaymentRequest.expires_at <= now)).all()
    for p in rows:
        p.status = PS.EXPIRED
        audit(db, "system", "payment.expired", f"payment:{p.id}", p.reference)
    db.commit()
    return len(rows)


AUTO_NOTE = "Auto-verified from an authenticated email from FamPay's official sender (not bank-confirmed)"


def run_verification(db, p: PaymentRequest, actor: str = "system", email_trusted: bool = False) -> None:
    p.status = PS.VERIFYING
    db.flush()
    adapter = get_adapter()
    try:
        res = adapter.verify(amount_paise=p.amount_paise, transaction_id=p.transaction_id or "",
                                   reference=p.reference, timestamp=p.detected_at or utcnow())
    except Exception as exc:  # provider down etc. -> stay pending, never auto-verify
        res = VerificationResult("UNAVAILABLE", f"Verification adapter error: {exc}")
    # Email-trust only when no independent source is configured; a real adapter always has the last word.
    if res.status == "UNAVAILABLE" and email_trusted and isinstance(adapter, NullAdapter):
        res = VerificationResult("CONFIRMED", AUTO_NOTE)
    if res.status == "CONFIRMED":
        p.status, p.verified_at = PS.VERIFIED, utcnow()
    elif res.status == "REJECTED":
        p.status = PS.FAILED
    else:
        p.status = PS.DETECTED
    p.verification_note = res.note
    audit(db, actor, f"payment.{p.status.lower()}", f"payment:{p.id}", res.note)
    if p.status == PS.VERIFIED:
        enqueue_webhook(db, p)


def apply_match(db, p: PaymentRequest, ev: EmailEvent, how: str, actor: str = "system") -> None:
    p.transaction_id = ev.transaction_id
    p.payer_name, p.utr = ev.payer_name, ev.utr
    p.detected_at = utcnow()
    p.status = PS.DETECTED
    ev.payment_id = p.id
    ev.outcome = EO.MANUAL if actor != "system" else EO.MATCHED
    ev.detail = how
    audit(db, actor, "payment.detected", f"payment:{p.id}", f"txn={ev.transaction_id} via {how}")
    db.flush()
    trusted = (actor == "system" and ev.auth_ok and settings.require_email_auth
               and settings.auto_verify_email)
    run_verification(db, p, actor, trusted)


def process_notification(db, n: Notification) -> EmailEvent:
    if n.message_id:
        existing = db.scalar(select(EmailEvent).where(
            EmailEvent.merchant_id == n.merchant_id, EmailEvent.message_id == n.message_id))
        if existing:
            return existing

    ev = EmailEvent(merchant_id=n.merchant_id, message_id=n.message_id, sender=n.sender,
                    subject=(n.subject or "")[:500], amount_paise=n.amount_paise,
                    transaction_id=n.transaction_id, payment_reference=n.payment_reference,
                    txn_time=n.timestamp, auth_ok=n.auth_ok, outcome=EO.UNMATCHED,
                    payer_name=n.payer_name, utr=n.utr, account_id=n.account_id)

    def finish(outcome: str, detail: str, payment: PaymentRequest | None = None) -> EmailEvent:
        ev.outcome, ev.detail = outcome, detail
        if payment is not None:
            ev.payment_id = payment.id
        db.add(ev)
        audit(db, "system", f"email.{outcome.lower()}", f"merchant:{n.merchant_id}", detail)
        db.commit()
        return ev

    # 1. Authenticity first, so a forged mail cannot "claim" a real transaction id.
    if settings.require_email_auth and not n.auth_ok:
        ev.transaction_id = None
        return finish(EO.REJECTED, f"Failed DKIM/SPF check (txn {n.transaction_id}). Gmail reported: {n.auth_note}")

    # 2. Idempotency on transaction id.
    if not n.transaction_id:
        return finish(EO.UNMATCHED, "No transaction id found in email")
    dup = db.scalar(select(EmailEvent).where(
        EmailEvent.merchant_id == n.merchant_id, EmailEvent.transaction_id == n.transaction_id))
    if dup:
        ev.transaction_id = None
        return finish(EO.DUPLICATE, f"Duplicate of event {dup.id} (txn {n.transaction_id})")

    grace = timedelta(seconds=settings.match_grace_seconds)
    ts = n.timestamp

    # 3a. Reference present -> direct association.
    if n.payment_reference:
        p = db.scalar(select(PaymentRequest).where(
            PaymentRequest.reference == n.payment_reference, PaymentRequest.merchant_id == n.merchant_id))
        if not p:
            return finish(EO.UNMATCHED, "Reference not found for this merchant")
        if p.account_id != n.account_id:
            return finish(EO.UNMATCHED, "Reference belongs to a different receiving account")
        if p.amount_paise != n.amount_paise:
            return finish(EO.MISMATCH, f"Paid {n.amount_paise/100:.2f} but requested {p.amount_paise/100:.2f}", p)
        if p.transaction_id or p.status in BUSY:
            return finish(EO.REVIEW, "Request already has a payment; possible double payment", p)
        if ts > p.expires_at + grace:
            if p.status in OPEN + (PS.EXPIRED,):
                p.status = PS.REVIEW
            return finish(EO.LATE, "Payment timestamp is after the QR expired", p)
        if ts < p.created_at - grace:
            return finish(EO.UNMATCHED, "Payment timestamp is before the QR was created", p)
        apply_match(db, p, ev, "payment_reference")
        db.add(ev)
        db.commit()
        return ev

    # 3b. No reference -> only a unique, time-window-bounded candidate may match.
    cands = db.scalars(select(PaymentRequest).where(
        PaymentRequest.merchant_id == n.merchant_id,
        PaymentRequest.amount_paise == n.amount_paise,
        PaymentRequest.account_id.is_(None) if n.account_id is None else PaymentRequest.account_id == n.account_id,
        PaymentRequest.transaction_id.is_(None),
        PaymentRequest.status.in_(OPEN + (PS.EXPIRED,)),
        PaymentRequest.created_at <= ts + grace,
        PaymentRequest.expires_at >= ts - grace)).all()

    if len(cands) > 1:
        refs = ", ".join(c.reference for c in cands)
        return finish(EO.AMBIGUOUS, f"{len(cands)} identical-amount requests could match: {refs}")
    if len(cands) == 1:
        if not settings.allow_unique_amount_match:
            return finish(EO.REVIEW, "Amount-only matching disabled; confirm manually", cands[0])
        apply_match(db, cands[0], ev, "unique_amount_in_window")
        db.add(ev)
        db.commit()
        return ev

    late = db.scalar(select(PaymentRequest).where(
        PaymentRequest.merchant_id == n.merchant_id,
        PaymentRequest.amount_paise == n.amount_paise,
        PaymentRequest.account_id.is_(None) if n.account_id is None else PaymentRequest.account_id == n.account_id,
        PaymentRequest.transaction_id.is_(None),
        PaymentRequest.expires_at < ts - grace,
        PaymentRequest.expires_at >= ts - timedelta(hours=24)))
    if late:
        return finish(EO.LATE, "Matches an expired request by amount only; review manually")
    return finish(EO.UNMATCHED, "No open payment request with this amount")


def assign_event(db, ev: EmailEvent, p: PaymentRequest, actor: str) -> None:
    if ev.outcome not in (EO.AMBIGUOUS, EO.LATE, EO.UNMATCHED, EO.REVIEW) or not ev.transaction_id:
        raise ValueError("This email event cannot be assigned")
    if p.merchant_id != ev.merchant_id:
        raise ValueError("Payment belongs to another merchant")
    if p.amount_paise != ev.amount_paise:
        raise ValueError("Amounts do not match")
    if p.transaction_id or p.status in BUSY:
        raise ValueError("Payment already has a transaction")
    apply_match(db, p, ev, f"manual assignment by {actor}", actor)
    db.commit()


def manual_decision(db, p: PaymentRequest, approve: bool, actor: str) -> None:
    if p.status != PS.DETECTED:
        raise ValueError("Only payments in PAYMENT_DETECTED can be decided manually")
    if approve:
        p.status, p.verified_at = PS.VERIFIED, utcnow()
        p.verification_note = f"Confirmed manually by {actor} against bank records"
        enqueue_webhook(db, p)
    else:
        p.status = PS.FAILED
        p.verification_note = f"Rejected manually by {actor}"
    audit(db, actor, f"payment.manual_{'verified' if approve else 'failed'}", f"payment:{p.id}", p.verification_note)
    db.commit()
