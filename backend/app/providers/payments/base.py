"""Payment provider interfaces, data models, and error types."""

from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field


class PaymentOrder(BaseModel):
    """Normalized order details returned by a payment provider."""

    id: str
    amount: int = Field(ge=0)
    currency: str = "INR"
    status: str = "created"
    receipt: str | None = None
    notes: dict[str, str] = Field(default_factory=dict)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class PaymentResult(BaseModel):
    """Result of a payment provider operation."""

    success: bool
    order: PaymentOrder | None = None
    error: str | None = None
    raw_response: dict[str, Any] = Field(default_factory=dict)


class PaymentProviderError(Exception):
    """Base exception for payment provider operations."""


class PaymentNetworkError(PaymentProviderError):
    """Raised when payment provider network communication fails."""


class PaymentAuthenticationError(PaymentProviderError):
    """Raised when provider credentials or authentication fails."""


class PaymentValidationError(PaymentProviderError):
    """Raised when order parameters fail provider validation."""


class OrderNotFoundError(PaymentProviderError):
    """Raised when a requested order is not found."""


@runtime_checkable
class PaymentProvider(Protocol):
    """Contract for payment operations (e.g., Mock, Razorpay MCP)."""

    def create_order(
        self,
        *,
        amount: int,
        currency: str = "INR",
        receipt: str | None = None,
        notes: dict[str, str] | None = None,
    ) -> PaymentResult:
        """Create an order with the payment provider."""
        ...

    def fetch_order(self, *, order_id: str) -> PaymentResult:
        """Fetch order details by order ID."""
        ...
