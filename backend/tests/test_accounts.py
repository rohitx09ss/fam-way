import base64
import io

from PIL import Image

from app.matching import Notification, process_notification
from app.models import EO, PS, utcnow
from app.qr import process_avatar, qr_data_url


def note(account_id=None, ref=None, txn="TXN999999999"):
    return Notification(merchant_id=1, amount_paise=50000, transaction_id=txn, timestamp=utcnow(),
                        payment_reference=ref, account_id=account_id)


def test_email_from_standby_inbox_does_not_match_primary_qr(db, make_payment):
    p = make_payment(500)                       # primary account request
    ev = process_notification(db, note(account_id=7))
    assert ev.outcome == EO.UNMATCHED and p.status == PS.WAITING


def test_email_matches_request_of_same_standby_account(db, make_payment):
    p = make_payment(500)
    p.account_id = 7
    db.commit()
    ev = process_notification(db, note(account_id=7))
    assert ev.outcome == EO.MATCHED and p.status == PS.DETECTED


def test_reference_from_another_account_is_refused(db, make_payment):
    p = make_payment(500)
    p.account_id = 7
    db.commit()
    ev = process_notification(db, note(ref=p.reference, account_id=None))
    assert ev.outcome == EO.UNMATCHED and p.status == PS.WAITING


def test_avatar_is_normalised_and_qr_still_renders_with_logo():
    buf = io.BytesIO()
    Image.new("RGB", (300, 200), (200, 30, 30)).save(buf, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    b64 = process_avatar(data_url)
    assert Image.open(io.BytesIO(base64.b64decode(b64))).size == (160, 160)
    assert qr_data_url("upi://pay?pa=a@fam&am=1.00", b64).startswith("data:image/png;base64,")


def test_bad_avatar_is_rejected():
    for bad in ("", "data:text/html;base64,AAAA", "data:image/png;base64,AAAA"):
        try:
            process_avatar(bad)
            assert False, bad
        except ValueError:
            pass


def test_every_builtin_logo_renders_and_works_in_a_qr():
    from app.logos import PRESETS, preset_b64
    for pid in PRESETS:
        b64 = preset_b64(pid, "R")
        assert Image.open(io.BytesIO(base64.b64decode(b64))).size == (160, 160)
        assert qr_data_url("upi://pay?pa=a@fam&am=1.00", b64).startswith("data:image/png;base64,")


def test_logo_choice_resolution():
    from app.models import MerchantSettings, User
    from app.services import effective_logo_choice, logo_b64_for
    import types
    u = types.SimpleNamespace(id=1, name="Ro", email="a@b.c", logo_choice=None, avatar_b64=None)
    assert effective_logo_choice(u) == "none"
    u.avatar_b64 = "QUJD"
    assert effective_logo_choice(u) == "custom"
    u.logo_choice = "none"
    assert logo_b64_for(None, u) is None  # "none" never touches the database
