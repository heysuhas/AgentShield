"""Razorpay Sandbox Payment Provider implementation."""

from typing import Any
import httpx

from app.providers.payments.base import (
    PaymentOrder,
    PaymentProvider,
    PaymentProviderError,
    PaymentResult,
)


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

        url = f"{self.base_url}/orders"
        # Razorpay expects amounts in the smallest currency subunit (e.g. paise for INR)
        payload: dict[str, Any] = {
            "amount": amount * 100,
            "currency": currency.upper(),
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
            raw_amount = data.get("amount", amount * 100)
            order = PaymentOrder(
                id=data["id"],
                amount=raw_amount // 100,
                currency=data.get("currency", currency),
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
            raw_amount = data.get("amount", 0)
            order = PaymentOrder(
                id=data["id"],
                amount=raw_amount // 100,
                currency=data.get("currency", "INR"),
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
