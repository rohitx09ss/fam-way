"""Independent payment verification adapters.

An email is only an ALERT. VERIFIED must come from an adapter that talks to an
authorised bank / payment-provider transaction API (or a human merchant
confirming against their bank statement). With adapter "none" every detected
payment stays at PAYMENT_DETECTED — VERIFICATION PENDING.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime

import httpx

from .config import settings


@dataclass
class VerificationResult:
    status: str  # CONFIRMED | REJECTED | UNAVAILABLE
    note: str = ""


class VerificationAdapter(ABC):
    @abstractmethod
    def verify(self, *, amount_paise: int, transaction_id: str, reference: str,
               timestamp: datetime) -> VerificationResult: ...


class NullAdapter(VerificationAdapter):
    def verify(self, **_) -> VerificationResult:
        return VerificationResult("UNAVAILABLE", "No independent verification source configured")


class HttpAdapter(VerificationAdapter):
    """Generic template. Adapt the request/response to your provider's real API.

    Expected response JSON: {"confirmed": true|false}
    """

    def verify(self, *, amount_paise, transaction_id, reference, timestamp) -> VerificationResult:
        r = httpx.post(
            settings.verification_api_url,
            headers={"Authorization": f"Bearer {settings.verification_api_key}"},
            json={
                "amount": amount_paise / 100,
                "transaction_id": transaction_id,
                "reference": reference,
                "timestamp": timestamp.isoformat(),
            },
            timeout=15,
        )
        r.raise_for_status()
        ok = bool(r.json().get("confirmed"))
        return VerificationResult("CONFIRMED" if ok else "REJECTED",
                                  "Confirmed by provider API" if ok else "Provider did not confirm")


def get_adapter() -> VerificationAdapter:
    if settings.verification_adapter == "http" and settings.verification_api_url:
        return HttpAdapter()
    return NullAdapter()
