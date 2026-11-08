import asyncio
import logging

from sqlalchemy import select

from .config import settings
from .db import SessionLocal
from .gmail_client import fetch_recent
from .ingest import handle_raw_email
from .matching import expire_due
from .models import MerchantSettings, User, utcnow
from .security import decrypt_secret

log = logging.getLogger(__name__)


def official_senders() -> set[str]:
    return {x.strip().lower() for x in settings.fampay_official_senders.split(",") if x.strip()}


def poll_merchant(merchant_id: int) -> None:
    with SessionLocal() as db:
        s = db.scalar(select(MerchantSettings).where(MerchantSettings.user_id == merchant_id))
        if not s or not s.is_enabled or not (s.gmail_address and s.app_password_enc):
            return
        senders = official_senders()
        if not senders:
            s.last_error = "FAMPAY_OFFICIAL_SENDERS is not configured on the server"
            db.commit()
            return
        try:
            password = decrypt_secret(s.app_password_enc)
            raws = []
            for sender in senders:
                raws += fetch_recent(s.imap_host, s.gmail_address, password, sender)
            for raw in raws:
                try:
                    handle_raw_email(db, merchant_id, senders, raw)
                except Exception:
                    db.rollback()
                    log.exception("Failed processing an email for merchant %s", merchant_id)
            s.last_error = None
        except Exception as exc:
            s.last_error = str(exc)[:500]
            log.warning("IMAP poll failed for merchant %s: %s", merchant_id, exc)
        s.last_poll_at = utcnow()
        db.commit()


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
