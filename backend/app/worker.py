import asyncio
import logging

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .gmail_client import fetch_recent
from .ingest import handle_raw_email
from .matching import expire_due
from .models import MerchantSettings, ReceivingAccount, User, utcnow
from .security import decrypt_secret

log = logging.getLogger(__name__)


def official_senders() -> set[str]:
    return {x.strip().lower() for x in settings.fampay_official_senders.split(",") if x.strip()}


def _poll_one(merchant_id: int, account_id: int | None) -> None:
    """Poll one inbox: the primary account (account_id None) or a standby ReceivingAccount."""
    with SessionLocal() as db:
        if account_id is None:
            obj = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == merchant_id))
        else:
            obj = db.get(ReceivingAccount, account_id)
        if not obj or not obj.is_enabled or not (obj.gmail_address and obj.app_password_enc):
            return
        senders = official_senders()
        if not senders:
            obj.last_error = "FAMPAY_OFFICIAL_SENDERS is not configured on the server"
            db.commit()
            return
        try:
            password = decrypt_secret(obj.app_password_enc)
            raws = []
            for sender in senders:
                raws += fetch_recent(obj.imap_host, obj.gmail_address, password, sender)
            for raw in raws:
                try:
                    handle_raw_email(db, merchant_id, senders, raw, account_id)
                except Exception:
                    db.rollback()
                    log.exception("Failed processing an email for merchant %s", merchant_id)
            obj.last_error = None
        except Exception as exc:
            obj.last_error = str(exc)[:500]
            log.warning("IMAP poll failed for merchant %s account %s: %s", merchant_id, account_id, exc)
        obj.last_poll_at = utcnow()
        db.commit()


def poll_merchant(merchant_id: int) -> None:
    with SessionLocal() as db:
        ids = [None] + list(db.scalars(select(ReceivingAccount.id).where(
            ReceivingAccount.merchant_id == merchant_id, ReceivingAccount.is_enabled.is_(True))).all())
    for aid in ids:
        _poll_one(merchant_id, aid)


async def expiry_loop() -> None:
    while True:
        try:
            with SessionLocal() as db:
                await asyncio.to_thread(expire_due, db)
        except Exception:
            log.exception("expiry loop error")
        await asyncio.sleep(5)


async def email_loop() -> None:
    while True:
        try:
            with SessionLocal() as db:
                ids = db.scalars(select(User.id).where(User.role == "merchant", User.is_active.is_(True))).all()
            for mid in ids:
                await asyncio.to_thread(poll_merchant, mid)
        except Exception:
            log.exception("email loop error")
        await asyncio.sleep(settings.imap_poll_seconds)


async def webhook_loop() -> None:
    from .webhooks import deliver_due
    while True:
        try:
            with SessionLocal() as db:
                await asyncio.to_thread(deliver_due, db)
        except Exception:
            log.exception("webhook loop error")
        await asyncio.sleep(3)
