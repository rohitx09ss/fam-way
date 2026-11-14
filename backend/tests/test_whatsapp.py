import pytest

from app.services import normalize_whatsapp, wa_link


@pytest.mark.parametrize("raw,expected", [
    ("98765 43210", "919876543210"), ("+91 98765-43210", "919876543210"), ("09876543210", "919876543210"),
    ("919876543210", "919876543210"), ("+1 415 555 2671", "14155552671"), ("0091 98765 43210", "919876543210"), ("", ""),
])
def test_whatsapp_numbers_are_normalised(raw, expected):
    assert normalize_whatsapp(raw) == expected


@pytest.mark.parametrize("bad", ["123", "abcdefghij", "+0 1234567", "98765"])
def test_bad_whatsapp_numbers_are_refused(bad):
    with pytest.raises(ValueError):
        normalize_whatsapp(bad)


def test_wa_link_is_a_wa_me_url_with_the_order():
    url = wa_link("919876543210", "pl_ABC")
    assert url.startswith("https://wa.me/919876543210?text=") and "pl_ABC" in url
