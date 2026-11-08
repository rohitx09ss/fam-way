from datetime import timezone

from app.email_parser import parse_email

RAW = b"""From: FamPay <no-reply@fam.example>
Subject: You received a payment
Message-ID: <abc123@mail.example>
Date: Sat, 31 Oct 2026 09:00:00 +0000
Authentication-Results: mx.google.com; dkim=pass header.d=fam.example; spf=pass
Content-Type: text/plain; charset=utf-8

You received \xe2\x82\xb91,500.50 from Rahul.
UPI Ref No: 612345678901
Date: 31 Oct 2026, 02:30 PM
Note: PAYABCDEF1234
"""


def test_parse_payment_email():
    p = parse_email(RAW)
    assert p.is_payment and p.auth_ok
    assert p.amount_paise == 150050
    assert p.transaction_id == "612345678901"
    assert p.payment_reference == "PAYABCDEF1234"
    assert p.from_addr == "no-reply@fam.example"
    assert p.timestamp.astimezone(timezone.utc).hour == 9    # 14:30 IST


def test_unrelated_email_is_ignored():
    raw = RAW.replace(b"You received", b"Your statement is ready, balance").replace(b"payment", b"update")
    assert not parse_email(raw).is_payment


def test_missing_auth_header():
    raw = RAW.replace(b"Authentication-Results: mx.google.com; dkim=pass header.d=fam.example; spf=pass\n", b"")
    assert not parse_email(raw).auth_ok


REAL = """From: FamPay <no-reply@fam.example>
Subject: Payment received
Message-ID: <real1@mail.example>
Date: Tue, 03 Nov 2026 06:25:00 +0000
Authentication-Results: mx.google.com; dkim=pass header.d=fam.example
Content-Type: text/plain; charset=utf-8

You have successfully received
\u20b91.0
from Mr Rohit Sharma
Transaction ID :
FMPIB6917510132
Date :
11:54 AM IST, 03 November 2026
Updated Balance :
\u20b94.02
UTR :
667331566848
If this was not done by you, call us and report this
""".encode("utf-8")


def test_real_fampay_layout():
    p = parse_email(REAL)
    assert p.is_payment and p.auth_ok
    assert p.amount_paise == 100              # not the updated balance
    assert p.transaction_id == "FMPIB6917510132"
    assert p.utr == "667331566848"
    assert p.payer_name == "Mr Rohit Sharma"
    assert (p.timestamp.hour, p.timestamp.minute) == (6, 24)   # 11:54 IST


def test_real_layout_html_body():
    html = (b"From: FamPay <no-reply@fam.example>\nSubject: Payment received\nMessage-ID: <h1@x>\n"
            b"Date: Tue, 03 Nov 2026 06:25:00 +0000\nContent-Type: text/html; charset=utf-8\n\n"
            b"<div>You have successfully received</div><h1>\xe2\x82\xb91.0</h1><p>from <b>Mr Rohit Sharma</b></p>"
            b"<p>Transaction ID :</p><p>FMPIB6917510132</p>")
    p = parse_email(html)
    assert p.payer_name == "Mr Rohit Sharma" and p.amount_paise == 100


def test_dkim_for_other_domain_is_not_accepted():
    raw = RAW.replace(b"header.d=fam.example; spf=pass", b"header.d=evil.example")
    assert not parse_email(raw).auth_ok


def test_injected_lower_auth_header_is_ignored():
    raw = RAW.replace(b"Authentication-Results: mx.google.com; dkim=pass header.d=fam.example; spf=pass\n",
                      b"Authentication-Results: mx.google.com; dkim=fail header.d=evil.example\n"
                      b"Authentication-Results: forged; dkim=pass header.d=fam.example\n")
    assert not parse_email(raw).auth_ok


def test_subject_style_famx_email_still_parses_amount_and_name():
    raw = REAL.replace(b"Subject: Payment received", b"Subject: You received \xe2\x82\xb91.0 in your FamX account")
    p = parse_email(raw)
    assert p.amount_paise == 100 and p.payer_name == "Mr Rohit Sharma"
