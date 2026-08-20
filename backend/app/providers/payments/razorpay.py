"""Razorpay Sandbox Payment Provider implementation."""

from typing import Any
import httpx

from app.providers.payments.base import (
    PaymentOrder,
    PaymentProvider,
    PaymentProviderError,
    PaymentResult,
)


_CURRENCY_SUBUNITS: dict[str, int] = {
    "INR": 100,
    "USD": 100,
    "EUR": 100,
    "GBP": 100,
    "SGD": 100,
    "AED": 100,
    "JPY": 1,
}


def _minor_units(amount: int, currency: str) -> int:
    try:
        return amount * _CURRENCY_SUBUNITS[currency.upper()]
    except KeyError as exc:
        raise ValueError(f"Unsupported currency: {currency}") from exc


class RazorpaySandboxProvider:
    """Payment provider interacting with Razorpay's test/sandbox environment."""

    def __init__(
        self,
        key_id: str | None = None,
        key_secret: str | None = None,
        base_url: str = "https://api.razorpay.com/v1",
        client: httpx.Client | None = None,
    ) -> None:
        self.key_id = key_id
        self.key_secret = key_secret
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=15.0)

    def create_order(
        self,
        *,
        amount: int,
        currency: str = "INR",
        receipt: str | None = None,
        notes: dict[str, Any] | None = None,
    ) -> PaymentResult:
        """Create an order in Razorpay's test environment."""
        if not self.key_id or not self.key_secret:
            return PaymentResult(
                success=False,
                error="Razorpay API credentials not configured",
                raw_response={"error": "AUTH_MISSING"},
            )

        norm_curr = currency.upper()
        if norm_curr not in _CURRENCY_SUBUNITS:
            return PaymentResult(
                success=False,
                error=f"Unsupported currency: {currency}",
                raw_response={"error": "UNSUPPORTED_CURRENCY"},
            )

        url = f"{self.base_url}/orders"
        payload: dict[str, Any] = {
            "amount": _minor_units(amount, norm_curr),
            "currency": norm_curr,
        }
        if receipt:
            payload["receipt"] = str(receipt)[:40]
        if notes:
            payload["notes"] = {str(k)[:256]: str(v)[:256] for k, v in notes.items()}

        try:
            resp = self._client.post(
                url,
                json=payload,
                auth=(self.key_id, self.key_secret),
            )
        except httpx.RequestError as exc:
            return PaymentResult(
                success=False,
                error=f"Razorpay network request failed: {exc}",
                raw_response={"exception": str(exc)},
            )

        if resp.status_code in (200, 201):
            data = resp.json()
            response_currency = str(data.get("currency", norm_curr)).upper()
            try:
                multiplier = _CURRENCY_SUBUNITS[response_currency]
            except KeyError:
                return PaymentResult(
                    success=False,
                    error=f"Unsupported currency in Razorpay response: {response_currency}",
                    raw_response=data,
                )
            raw_amount = data.get("amount", _minor_units(amount, norm_curr))
            order = PaymentOrder(
                id=data["id"],
                amount=raw_amount // multiplier,
                currency=response_currency,
                status=data.get("status", "created"),
                receipt=data.get("receipt"),
            )
            return PaymentResult(
                success=True,
                order=order,
                raw_response=data,
            )

        error_data = {}
        try:
            error_data = resp.json()
            error_msg = error_data.get("error", {}).get(
                "description", resp.text
            )
        except Exception:
            error_msg = resp.text

        return PaymentResult(
            success=False,
            error=f"Razorpay error ({resp.status_code}): {error_msg}",
            raw_response=error_data if error_data else {"raw": resp.text},
        )

    def fetch_order(self, *, order_id: str) -> PaymentResult:
        """Fetch an order by ID from Razorpay."""
        if not self.key_id or not self.key_secret:
            return PaymentResult(
                success=False,
                error="Razorpay API credentials not configured",
                raw_response={"error": "AUTH_MISSING"},
            )

        url = f"{self.base_url}/orders/{order_id}"

        try:
            resp = self._client.get(
                url,
                auth=(self.key_id, self.key_secret),
            )
        except httpx.RequestError as exc:
            return PaymentResult(
                success=False,
                error=f"Razorpay network request failed: {exc}",
                raw_response={"exception": str(exc)},
            )

        if resp.status_code == 200:
            data = resp.json()
            response_currency = str(data.get("currency", "INR")).upper()
            try:
                multiplier = _CURRENCY_SUBUNITS[response_currency]
            except KeyError:
                return PaymentResult(
                    success=False,
                    error=f"Unsupported currency in Razorpay response: {response_currency}",
                    raw_response=data,
                )
            raw_amount = data.get("amount", 0)
            order = PaymentOrder(
                id=data["id"],
                amount=raw_amount // multiplier,
                currency=response_currency,
                status=data.get("status", "created"),
                receipt=data.get("receipt"),
            )
            return PaymentResult(
                success=True,
                order=order,
                raw_response=data,
            )

        error_data = {}
        try:
            error_data = resp.json()
            error_msg = error_data.get("error", {}).get(
                "description", resp.text
            )
        except Exception:
            error_msg = resp.text

        return PaymentResult(
            success=False,
            error=f"Razorpay error ({resp.status_code}): {error_msg}",
            raw_response=error_data if error_data else {"raw": resp.text},
        )

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()
