import logging

from sqlalchemy import select

from .email_parser import parse_email
from .matching import Notification, process_notification
from .models import EmailEvent

log = logging.getLogger(__name__)


def handle_raw_email(db, merchant_id: int, allowed_senders: set[str], raw: bytes, account_id: int | None = None):
    """Parse one raw email and feed it to the matching engine. Returns event or None."""
    parsed = parse_email(raw)
    if parsed.from_addr not in allowed_senders:
        return None  # only FamPay's official sender; IMAP FROM search is just a substring match
    if not parsed.is_payment:
        return None  # unrelated mail from the same sender
    if parsed.message_id and db.scalar(select(EmailEvent.id).where(
            EmailEvent.merchant_id == merchant_id, EmailEvent.message_id == parsed.message_id)):
        return None  # already processed
    return process_notification(db, Notification(
        merchant_id=merchant_id, amount_paise=parsed.amount_paise, transaction_id=parsed.transaction_id,
        timestamp=parsed.timestamp, payment_reference=parsed.payment_reference,
        message_id=parsed.message_id, sender=parsed.from_addr, subject=parsed.subject,
        auth_ok=parsed.auth_ok, payer_name=parsed.payer_name, utr=parsed.utr,
        auth_note=parsed.auth_note, account_id=account_id))
