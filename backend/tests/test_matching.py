from datetime import timedelta

from app import matching
from app.matching import Notification, expire_due, process_notification
from app.models import EO, PS, utcnow
from app.verification import VerificationResult


def notif(amount=500, txn="TXN000000001", ref=None, ts=None, msg=None, auth=True):
    return Notification(merchant_id=1, amount_paise=amount * 100, transaction_id=txn,
                        timestamp=ts or utcnow(), payment_reference=ref, message_id=msg, auth_ok=auth)


def test_successful_payment_is_detected_not_verified(db, make_payment):
    p = make_payment(500)
    ev = process_notification(db, notif(ref=p.reference))
    assert ev.outcome == EO.MATCHED
    assert p.status == PS.DETECTED            # no independent verification configured
    assert p.transaction_id == "TXN000000001"


def test_verified_only_when_adapter_confirms(db, make_payment, monkeypatch):
    class Yes:
        def verify(self, **_):
            return VerificationResult("CONFIRMED", "bank ok")
    monkeypatch.setattr(matching, "get_adapter", lambda: Yes())
    p = make_payment(500)
    process_notification(db, notif(ref=p.reference))
    assert p.status == PS.VERIFIED and p.verified_at is not None


def test_adapter_failure_never_verifies(db, make_payment, monkeypatch):
    class Boom:
        def verify(self, **_):
            raise RuntimeError("down")
    monkeypatch.setattr(matching, "get_adapter", lambda: Boom())
    p = make_payment(500)
    process_notification(db, notif(ref=p.reference))
    assert p.status == PS.DETECTED


def test_duplicate_transaction_is_ignored(db, make_payment):
    p1, p2 = make_payment(500), make_payment(500)
    process_notification(db, notif(ref=p1.reference, msg="<a>"))
    ev = process_notification(db, notif(ref=p2.reference, msg="<b>"))   # same txn id, different email
    assert ev.outcome == EO.DUPLICATE
    assert p2.status == PS.WAITING and p2.transaction_id is None


def test_same_message_id_is_idempotent(db, make_payment):
    p = make_payment(500)
    a = process_notification(db, notif(ref=p.reference, msg="<a>"))
    b = process_notification(db, notif(ref=p.reference, msg="<a>"))
    assert a.id == b.id


def test_late_payment_goes_to_review(db, make_payment):
    p = make_payment(500, age_s=600, ttl_s=300, status=PS.EXPIRED)
    ev = process_notification(db, notif(ref=p.reference, ts=utcnow()))
    assert ev.outcome == EO.LATE
    assert p.status == PS.REVIEW and p.transaction_id is None


def test_payment_made_in_time_but_email_delayed_is_accepted(db, make_payment):
    p = make_payment(500, age_s=400, ttl_s=300, status=PS.EXPIRED)   # timer already expired
    paid_at = p.created_at + timedelta(seconds=120)
    ev = process_notification(db, notif(ref=p.reference, ts=paid_at))
    assert ev.outcome == EO.MATCHED and p.status == PS.DETECTED


def test_amount_mismatch_is_not_assigned(db, make_payment):
    p = make_payment(500)
    ev = process_notification(db, notif(amount=499, ref=p.reference))
    assert ev.outcome == EO.MISMATCH
    assert p.status == PS.WAITING and p.transaction_id is None


def test_ambiguous_identical_amounts_are_never_auto_assigned(db, make_payment):
    a, b = make_payment(500), make_payment(500)
    ev = process_notification(db, notif())     # no reference
    assert ev.outcome == EO.AMBIGUOUS and ev.payment_id is None
    assert a.status == PS.WAITING and b.status == PS.WAITING
    assert a.reference in ev.detail and b.reference in ev.detail


def test_single_candidate_without_reference_matches(db, make_payment):
    p = make_payment(750)
    ev = process_notification(db, notif(amount=750))
    assert ev.outcome == EO.MATCHED and ev.payment_id == p.id


def test_unique_amount_matching_can_be_disabled(db, make_payment, monkeypatch):
    monkeypatch.setattr(matching.settings, "allow_unique_amount_match", False)
    p = make_payment(750)
    ev = process_notification(db, notif(amount=750))
    assert ev.outcome == EO.REVIEW and p.status == PS.WAITING


def test_unauthenticated_email_is_rejected_and_cannot_claim_txn(db, make_payment):
    p = make_payment(500)
    ev = process_notification(db, notif(ref=p.reference, auth=False, msg="<forged>"))
    assert ev.outcome == EO.REJECTED and ev.transaction_id is None
    ok = process_notification(db, notif(ref=p.reference, msg="<real>"))    # genuine mail, same txn id
    assert ok.outcome == EO.MATCHED


def test_manual_assignment_resolves_ambiguity(db, make_payment):
    a, b = make_payment(500), make_payment(500)
    ev = process_notification(db, notif())
    matching.assign_event(db, ev, b, "m@x.com")
    assert b.status == PS.DETECTED and a.status == PS.WAITING and ev.outcome == EO.MANUAL


def test_expiry_uses_server_time(db, make_payment):
    old = make_payment(100, age_s=400)
    fresh = make_payment(100, age_s=10)
    assert expire_due(db) == 1
    assert old.status == PS.EXPIRED and fresh.status == PS.WAITING


def test_manual_confirm_only_from_detected(db, make_payment):
    p = make_payment(500)
    try:
        matching.manual_decision(db, p, True, "m@x.com")
        assert False, "should refuse"
    except ValueError:
        pass
    process_notification(db, notif(ref=p.reference))
    matching.manual_decision(db, p, True, "m@x.com")
    assert p.status == PS.VERIFIED


def test_auto_verify_authenticated_unambiguous_match(db, make_payment, monkeypatch):
    monkeypatch.setattr(matching.settings, "auto_verify_email", True)
    p = make_payment(500)
    process_notification(db, notif(ref=p.reference))
    assert p.status == PS.VERIFIED and "not bank-confirmed" in p.verification_note


def test_auto_verify_works_for_unique_amount_without_reference(db, make_payment, monkeypatch):
    monkeypatch.setattr(matching.settings, "auto_verify_email", True)
    p = make_payment(1)
    process_notification(db, notif(amount=1))
    assert p.status == PS.VERIFIED


def test_auto_verify_never_applies_to_ambiguous_or_late(db, make_payment, monkeypatch):
    monkeypatch.setattr(matching.settings, "auto_verify_email", True)
    a, b = make_payment(500), make_payment(500)
    process_notification(db, notif())
    assert a.status == PS.WAITING and b.status == PS.WAITING
    late = make_payment(300, age_s=600, status=PS.EXPIRED)
    process_notification(db, notif(amount=300, txn="TXN000000009", ref=late.reference))
    assert late.status == PS.REVIEW


def test_auto_verify_needs_authenticated_email(db, make_payment, monkeypatch):
    monkeypatch.setattr(matching.settings, "auto_verify_email", True)
    monkeypatch.setattr(matching.settings, "require_email_auth", False)
    p = make_payment(500)
    process_notification(db, notif(ref=p.reference, auth=False))
    assert p.status == PS.DETECTED


def test_real_adapter_overrides_email_trust(db, make_payment, monkeypatch):
    monkeypatch.setattr(matching.settings, "auto_verify_email", True)
    class No:
        def verify(self, **_):
            return VerificationResult("REJECTED", "bank says no")
    monkeypatch.setattr(matching, "get_adapter", lambda: No())
    p = make_payment(500)
    process_notification(db, notif(ref=p.reference))
    assert p.status == PS.FAILED
