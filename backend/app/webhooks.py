import hashlib
import hmac
import ipaddress
import json
import logging
import secrets
import socket
from datetime import timedelta
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from .models import (PaymentLink, PaymentRequest, User, WebhookDelivery,
                     WebhookEndpoint, utcnow)

log = logging.getLogger(__name__)
BACKOFF = [30, 120, 600, 3600]  # seconds between attempts; 5 attempts in total


def validate_url(url: str) -> None:
    """Reject non-http(s) and private/internal targets (SSRF guard)."""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise ValueError("URL must start with http:// or https://")
    if u.username or u.password:
        raise ValueError("URL must not contain credentials")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ValueError("Host could not be resolved")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified):
            raise ValueError("Private or internal addresses are not allowed")


def sign(secret: str, body: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


def ensure_secret(db, user: User) -> str:
    if not user.webhook_secret:
        user.webhook_secret = "whsec_" + secrets.token_urlsafe(24)
    return user.webhook_secret


def payment_payload(db, p: PaymentRequest, event: str) -> dict:
    link = db.get(PaymentLink, p.link_id) if p.link_id else None
    return {
        "event": event,
        "created_at": utcnow().isoformat(),
        "data": {
            "order": link.slug if link else None,
            "order_id": link.order_id if link else None,
            "reference": p.reference,
            "amount": p.amount_paise / 100,
            "currency": "INR",
            "status": p.status,
            "transaction_id": p.transaction_id,
            "utr": p.utr,
            "payer_name": p.payer_name,
            "customer_name": p.customer_name,
            "verified_at": p.verified_at.isoformat() if p.verified_at else None,
        },
    }


def _queue(db, merchant_id: int, event: str, payload: dict, only_endpoint: int | None = None) -> int:
    q = select(WebhookEndpoint).where(WebhookEndpoint.merchant_id == merchant_id, WebhookEndpoint.is_active.is_(True))
    if only_endpoint:
        q = q.where(WebhookEndpoint.id == only_endpoint)
    n = 0
    for ep in db.scalars(q).all():
        db.add(WebhookDelivery(merchant_id=merchant_id, endpoint_id=ep.id, event=event,
                               payload=json.dumps(payload, separators=(",", ":"))))
        n += 1
    return n


def enqueue(db, p: PaymentRequest, event: str = "payment.verified") -> int:
    """Queue a delivery for every active endpoint of the merchant (caller commits)."""
    return _queue(db, p.merchant_id, event, payment_payload(db, p, event))


def enqueue_test(db, merchant_id: int, endpoint_id: int) -> int:
    payload = {"event": "payment.test", "created_at": utcnow().isoformat(),
               "data": {"order": "pl_TEST0000", "reference": "PAYTEST000000", "amount": 1.0, "currency": "INR",
                        "status": "VERIFIED", "transaction_id": "TEST0000000", "payer_name": "Test Payer"}}
    return _queue(db, merchant_id, "payment.test", payload, endpoint_id)


def deliver_due(db) -> int:
    now = utcnow()
    rows = db.scalars(select(WebhookDelivery).where(
        WebhookDelivery.status == "PENDING", WebhookDelivery.next_attempt_at <= now)
        .order_by(WebhookDelivery.id).limit(20)).all()
    for d in rows:
        ep = db.get(WebhookEndpoint, d.endpoint_id)
        user = db.get(User, d.merchant_id)
        if not ep or not ep.is_active or not user:
            d.status, d.response_body = "FAILED", "Endpoint removed or disabled"
            continue
        code, body, ok = None, "", False
        try:
            validate_url(ep.url)
            r = httpx.post(ep.url, content=d.payload, timeout=10, follow_redirects=False, headers={
                "Content-Type": "application/json", "X-Event": d.event,
                "X-Signature": sign(user.webhook_secret or "", d.payload), "User-Agent": "fpay-webhook/1.0"})
            code, body = r.status_code, r.text[:1000]
            ok = 200 <= code < 300
        except Exception as exc:
            body = str(exc)[:500]
        d.attempts += 1
        d.last_attempt_at, d.response_code, d.response_body = now, code, body
        if ok:
            d.status = "SUCCESS"
        elif d.attempts >= 5:
            d.status = "FAILED"
        else:
            d.next_attempt_at = now + timedelta(seconds=BACKOFF[d.attempts - 1])
    db.commit()
    return len(rows)
