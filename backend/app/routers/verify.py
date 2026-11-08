import hmac
from datetime import timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select

from ..config import settings
from ..db import get_db
from ..email_parser import IST
from ..matching import Notification, process_notification
from ..models import PaymentRequest
from ..schemas import NotificationIn, event_out

router = APIRouter(prefix="/api/v1/verify", tags=["verification"])


@router.post("/notification")
def verify_notification(body: NotificationIn, x_worker_secret: str = Header(default=""), db=Depends(get_db)):
    """Internal/trusted endpoint: submit an extracted payment notification for matching.

    Protected by X-Worker-Secret. Naive timestamps are treated as IST.
    """
    if not hmac.compare_digest(x_worker_secret, settings.worker_shared_secret):
        raise HTTPException(401, "Bad worker secret")
    merchant_id = body.merchant_id
    if merchant_id is None and body.payment_reference:
        p = db.scalar(select(PaymentRequest).where(PaymentRequest.reference == body.payment_reference))
        merchant_id = p.merchant_id if p else None
    if merchant_id is None:
        raise HTTPException(422, "merchant_id is required when payment_reference is missing or unknown")
    ts = body.timestamp if body.timestamp.tzinfo else body.timestamp.replace(tzinfo=IST)
    ev = process_notification(db, Notification(
        merchant_id=merchant_id, amount_paise=int((body.amount * 100).to_integral_value()),
        transaction_id=body.transaction_id, timestamp=ts.astimezone(timezone.utc),
        payment_reference=body.payment_reference, source=body.source, auth_ok=True,
        payer_name=body.payer_name, utr=body.utr))
    return event_out(ev)
