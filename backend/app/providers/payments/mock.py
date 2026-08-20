"""Deterministic in-memory mock payment provider."""

from app.providers.payments.base import PaymentOrder, PaymentResult


class MockPaymentProvider:
    """In-memory mock payment provider for deterministic testing and local runs."""

    def __init__(
        self,
        should_fail: bool = False,
        failure_error: str = "Simulated payment provider failure",
    ) -> None:
        self._orders: dict[str, PaymentOrder] = {}
        self._counter: int = 0
        self.should_fail = should_fail
        self.failure_error = failure_error

    def create_order(
        self,
        *,
        amount: int,
        currency: str = "INR",
        receipt: str | None = None,
        notes: dict[str, str] | None = None,
    ) -> PaymentResult:
        """Create a mock order with sequential IDs."""
        if self.should_fail:
            return PaymentResult(
                success=False,
                error=self.failure_error,
                raw_response={"mock": True, "error": self.failure_error},
            )

        if amount < 0:
            return PaymentResult(
                success=False,
                error="Amount must be non-negative",
                raw_response={"mock": True, "error": "INVALID_AMOUNT"},
            )

        self._counter += 1
        order_id = f"order_mock_{self._counter:06d}"
        order = PaymentOrder(
            id=order_id,
            amount=amount,
            currency=currency,
            status="created",
            receipt=receipt,
            notes=notes or {},
        )
        self._orders[order_id] = order
        return PaymentResult(
            success=True,
            order=order,
            raw_response={"mock": True, "order_id": order_id},
        )

    def fetch_order(self, *, order_id: str) -> PaymentResult:
        """Fetch an existing mock order by ID."""
        if self.should_fail:
            return PaymentResult(
                success=False,
                error=self.failure_error,
                raw_response={"mock": True, "error": self.failure_error},
            )

        order = self._orders.get(order_id)
        if not order:
            return PaymentResult(
                success=False,
                error=f"Order {order_id} not found",
                raw_response={"mock": True, "error": "NOT_FOUND"},
            )

        return PaymentResult(
            success=True,
            order=order,
            raw_response={"mock": True, "order_id": order_id},
        )

    def simulate_failure(
        self, error: str = "Simulated payment provider failure"
    ) -> None:
        """Configure mock provider to simulate downstream failures."""
        self.should_fail = True
        self.failure_error = error

    def simulate_success(self) -> None:
        """Restore mock provider to succeed."""
        self.should_fail = False

    def reset(self) -> None:
        """Clear all stored orders and reset counter."""
        self._orders.clear()
        self._counter = 0
        self.should_fail = False
