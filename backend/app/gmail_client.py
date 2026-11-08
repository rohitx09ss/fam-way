import imaplib
from datetime import date, timedelta


def fetch_recent(host: str, user: str, password: str, sender: str, days: int = 2, limit: int = 40) -> list[bytes]:
    """Fetch raw RFC822 messages from `sender` in the last `days` days.

    Uses BODY.PEEK and a read-only mailbox so flags are never modified;
    de-duplication is done by Message-ID in the database.
    """
    since = (date.today() - timedelta(days=days)).strftime("%d-%b-%Y")
    out: list[bytes] = []
    with imaplib.IMAP4_SSL(host, 993, timeout=30) as m:
        m.login(user, password)
        m.select("INBOX", readonly=True)
        typ, data = m.search(None, "FROM", f'"{sender}"', "SINCE", since)
        if typ != "OK" or not data or not data[0]:
            return out
        for num in data[0].split()[-limit:]:
            typ, parts = m.fetch(num, "(BODY.PEEK[])")
            if typ == "OK" and parts and isinstance(parts[0], tuple):
                out.append(parts[0][1])
    return out


def test_connection(host: str, user: str, password: str) -> tuple[bool, str]:
    try:
        with imaplib.IMAP4_SSL(host, 993, timeout=20) as m:
            m.login(user, password)
            typ, _ = m.select("INBOX", readonly=True)
            return (typ == "OK", "Connected to inbox" if typ == "OK" else "Could not open INBOX")
    except imaplib.IMAP4.error as exc:
        return False, f"Login failed: {exc}"
    except Exception as exc:  # network, DNS, timeout
        return False, f"Connection error: {exc}"
