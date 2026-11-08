"""Parse FamPay-style payment notification emails.

The regexes are deliberately tolerant. FamPay's real email template may differ:
adjust AMOUNT_RE / TXN_RE / REF_RE below after looking at one real notification.
"""
import html
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from email import message_from_bytes, policy
from email.utils import parseaddr, parsedate_to_datetime

from .config import settings

IST = timezone(timedelta(hours=5, minutes=30))

AMOUNT_RE = re.compile(r"(?:₹|Rs\.?|INR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", re.I)
# Real FamPay layout: "You have successfully received ₹1.0 from Mr Rohit Sharma"
RECEIVED_AMT_RE = re.compile(r"received\s*(?:₹|Rs\.?|INR)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", re.I)
NAME_AFTER_AMT_RE = re.compile(
    r"(?:₹|Rs\.?|INR)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*from\s+(.{2,80}?)\s*"
    r"(?:\r?\n|Transaction\s*ID|Txn\s*ID|UTR|Date\s*:|Updated\s*Balance|$)", re.I)
NAME_GENERIC_RE = re.compile(
    r"\bfrom\s+(.{2,80}?)\s*(?:\r?\n|Transaction\s*ID|Txn\s*ID|UTR|Date\s*:|Updated\s*Balance|$)", re.I)
UTR_RE = re.compile(r"\bUTR\s*[:\-#]?\s*([0-9]{6,})", re.I)
# "11:54 AM IST, 03 November 2026"  (time first, then date)
TIME_FIRST_RE = re.compile(
    r"(\d{1,2}:\d{2}\s*[AaPp][Mm])\s*(?:IST)?,?\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})")
TXN_RE = re.compile(
    r"(?:UPI\s*Ref(?:erence)?(?:\s*(?:No|ID|Number))?\.?|Transaction\s*ID|Txn\s*ID|"
    r"Ref(?:erence)?\s*(?:No|ID|Number)|UTR)\s*[:\-#]?\s*([A-Za-z0-9]{8,})",
    re.I,
)
REF_RE = re.compile(r"\b(PAY[0-9A-F]{10})\b")
ISO_RE = re.compile(r"(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)")
DMY_RE = re.compile(r"(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4},?\s+\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)")


@dataclass
class ParsedEmail:
    message_id: str | None
    from_addr: str
    subject: str
    amount_paise: int | None
    transaction_id: str | None
    payment_reference: str | None
    timestamp: datetime
    auth_ok: bool
    is_payment: bool
    payer_name: str | None = None
    utr: str | None = None
    auth_note: str = ""


def _csv(s: str) -> list[str]:
    return [x.strip().lower() for x in s.split(",") if x.strip()]


def _body_text(msg) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    text = part.get_content()
    if part.get_content_type() == "text/html":
        text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", text)
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"[ \t\r\f\v]+", " ", text)


def extract_payer_name(body: str, subject: str) -> str | None:
    for text, rx in ((body, NAME_AFTER_AMT_RE), (subject, NAME_AFTER_AMT_RE), (body, NAME_GENERIC_RE)):
        m = rx.search(text)
        if m:
            name = re.sub(r"[^\w .'\-]", "", re.sub(r"\s+", " ", m.group(1))).strip(" .-")
            if len(name) >= 2:
                return name[:80]
    return None


def parse_timestamp(text: str, fallback: datetime) -> datetime:
    m = TIME_FIRST_RE.search(text)
    if m:
        t = re.sub(r"(\d)\s*([AaPp][Mm])", r"\1 \2", m.group(1)).upper()
        d = re.sub(r"\s+", " ", m.group(2))
        for fmt in ("%d %B %Y %I:%M %p", "%d %b %Y %I:%M %p"):
            try:
                return datetime.strptime(f"{d} {t}", fmt).replace(tzinfo=IST).astimezone(timezone.utc)
            except ValueError:
                continue
    m = ISO_RE.search(text)
    if m:
        try:
            dt = datetime.fromisoformat(m.group(1).replace(" ", "T"))
            return (dt if dt.tzinfo else dt.replace(tzinfo=IST)).astimezone(timezone.utc)
        except ValueError:
            pass
    m = DMY_RE.search(text)
    if m:
        s = re.sub(r"\s+", " ", m.group(1).replace(",", "")).strip()
        s = re.sub(r"(\d)([AaPp][Mm])", r"\1 \2", s).upper()
        for fmt in ("%d %b %Y %I:%M %p", "%d %B %Y %I:%M %p", "%d %b %Y %H:%M", "%d %B %Y %H:%M"):
            try:
                return datetime.strptime(s, fmt).replace(tzinfo=IST).astimezone(timezone.utc)
            except ValueError:
                continue
    return fallback


def _aligned(domain: str, from_domain: str) -> bool:
    domain, from_domain = domain.lower().lstrip("@"), from_domain.lower()
    return domain == from_domain or domain.endswith("." + from_domain) or from_domain.endswith("." + domain)


def authenticated(msg, from_addr: str = "") -> bool:
    """True only if the receiving mail server (Gmail) recorded a DKIM or SPF pass
    whose domain is aligned with the From domain.

    Only the TOPMOST Authentication-Results header is trusted: it is the one added
    by our own mail server; lower ones could be injected by the sender.
    """
    headers = msg.get_all("Authentication-Results", []) or []
    if not headers or "@" not in from_addr:
        return False
    from_domain = from_addr.rsplit("@", 1)[1]
    top = str(headers[0])
    for m in re.finditer(r"dkim=pass[^;]*?header\.(?:d|i)=@?([\w.\-]+)", top, re.I):
        if _aligned(m.group(1).split("@")[-1], from_domain):
            return True
    for m in re.finditer(r"spf=pass[^;]*?smtp\.mailfrom=(?:[\w.+\-]+@)?([\w.\-]+)", top, re.I):
        if _aligned(m.group(1), from_domain):
            return True
    return False


def parse_email(raw: bytes) -> ParsedEmail:
    msg = message_from_bytes(raw, policy=policy.default)
    subject = str(msg.get("Subject", "") or "")
    body = _body_text(msg)
    text = f"{subject}\n{body}"
    try:
        date_hdr = parsedate_to_datetime(str(msg.get("Date")))
        date_hdr = date_hdr if date_hdr.tzinfo else date_hdr.replace(tzinfo=timezone.utc)
        date_hdr = date_hdr.astimezone(timezone.utc)
    except Exception:
        date_hdr = datetime.now(timezone.utc)

    amount = None
    m = RECEIVED_AMT_RE.search(text) or AMOUNT_RE.search(text)
    if m:
        try:
            amount = int((Decimal(m.group(1).replace(",", "")) * 100).to_integral_value())
        except InvalidOperation:
            amount = None
    t = TXN_RE.search(text)
    u = UTR_RE.search(text)
    r = REF_RE.search(text)
    low = text.lower()
    is_payment = (
        amount is not None
        and any(k in low for k in _csv(settings.payment_keywords))
        and not any(k in low for k in _csv(settings.negative_keywords))
    )
    return ParsedEmail(
        message_id=(str(msg.get("Message-ID")).strip() if msg.get("Message-ID") else None),
        from_addr=parseaddr(str(msg.get("From", "")))[1].lower(),
        subject=subject,
        amount_paise=amount,
        transaction_id=t.group(1) if t else None,
        payment_reference=r.group(1) if r else None,
        timestamp=parse_timestamp(text, date_hdr),
        auth_ok=authenticated(msg, parseaddr(str(msg.get("From", "")))[1].lower()),
        is_payment=is_payment,
        payer_name=extract_payer_name(body, subject),
        utr=u.group(1) if u else None,
        auth_note=re.sub(r"\s+", " ", str((msg.get_all("Authentication-Results", []) or ["(none)"])[0]))[:300],
    )
