from datetime import timedelta

import pytest
from sqlalchemy import select

from app import matching
from app.matching import Notification, process_notification
from app.models import ApiKey, MerchantSettings, User, WebhookDelivery, WebhookEndpoint, utcnow
from app.services import create_link, hash_key, link_state, roll_api_key, start_session
from app.webhooks import ensure_secret, enqueue_test, sign, validate_url


@pytest.fixture()
def merchant(db):
    db.add(MerchantSettings(user_id=1, store_name="Shop", upi_id="shop@fam"))
    db.commit()


def pay(db, p, txn="TXN123456789"):
    return process_notification(db, Notification(merchant_id=1, amount_paise=p.amount_paise, transaction_id=txn,
                                                 timestamp=utcnow(), payment_reference=p.reference))


def test_session_reuses_live_qr(db, merchant):
    link = create_link(db, 1, 10000, 3600)
    db.commit()
    s1, p1 = start_session(db, link)
    s2, p2 = start_session(db, link)
    assert s1 == s2 == "ACTIVE" and p1.id == p2.id and p1.link_id == link.id


def test_link_becomes_paid_after_auto_verify(db, merchant, monkeypatch):
    monkeypatch.setattr(matching.settings, "auto_verify_email", True)
    link = create_link(db, 1, 10000, 3600)
    db.commit()
    _, p = start_session(db, link)
    pay(db, p)
    assert link_state(db, link)[0] == "PAID"


def test_no_second_qr_while_payment_awaits_verification(db, merchant):
    link = create_link(db, 1, 10000, 3600)
    db.commit()
    _, p = start_session(db, link)
    pay(db, p)                       # auto-verify is off in tests -> PAYMENT_DETECTED
    st, cur = start_session(db, link)
    assert st == "PENDING_VERIFICATION" and cur.id == p.id


def test_expired_link_gets_no_session(db, merchant):
    link = create_link(db, 1, 10000, 3600)
    link.expires_at = utcnow() - timedelta(seconds=5)
    db.commit()
    assert start_session(db, link)[0] == "EXPIRED"


def test_webhook_queued_and_signed_when_verified(db, merchant, monkeypatch):
    monkeypatch.setattr(matching.settings, "auto_verify_email", True)
    user = db.get(User, 1)
    secret = ensure_secret(db, user)
    db.add(WebhookEndpoint(merchant_id=1, name="srv", url="https://example.com/hook"))
    link = create_link(db, 1, 10000, 3600, order_id="ORD-1")
    db.commit()
    _, p = start_session(db, link)
    pay(db, p)
    d = db.scalars(select(WebhookDelivery)).all()
    assert len(d) == 1 and d[0].event == "payment.verified" and '"order_id":"ORD-1"' in d[0].payload
    assert sign(secret, d[0].payload).startswith("sha256=")


def test_no_webhook_when_only_detected(db, merchant):
    db.add(WebhookEndpoint(merchant_id=1, name="srv", url="https://example.com/hook"))
    link = create_link(db, 1, 10000, 3600)
    db.commit()
    _, p = start_session(db, link)
    pay(db, p)
    assert db.scalars(select(WebhookDelivery)).all() == []


def test_test_event_goes_to_one_endpoint(db, merchant):
    e = WebhookEndpoint(merchant_id=1, name="srv", url="https://example.com/hook")
    db.add(e)
    db.commit()
    assert enqueue_test(db, 1, e.id) == 1


@pytest.mark.parametrize("url", ["ftp://example.com/x", "http://127.0.0.1/x", "http://localhost/x",
                                 "http://10.0.0.5/x", "http://169.254.169.254/latest", "http://user:pw@example.com/"])
def test_private_or_bad_urls_are_blocked(url):
    with pytest.raises(ValueError):
        validate_url(url)


def test_rolling_a_key_revokes_the_old_one(db):
    k1 = roll_api_key(db, 1)
    db.commit()
    k2 = roll_api_key(db, 1)
    db.commit()
    rows = {r.key_hash: r.is_active for r in db.scalars(select(ApiKey)).all()}
    assert rows[hash_key(k1)] is False and rows[hash_key(k2)] is True
