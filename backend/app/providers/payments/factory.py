"""Payment Provider factory based on application settings."""

from functools import lru_cache
from app.config import Settings, get_settings
from app.providers.payments.base import PaymentProvider
from app.providers.payments.mock import MockPaymentProvider
from app.providers.payments.razorpay import RazorpaySandboxProvider


@lru_cache
def get_payment_provider() -> PaymentProvider:
    """Return the active payment provider based on configuration settings."""
    settings = get_settings()

    if settings.PAYMENT_PROVIDER.lower() == "razorpay":
        return RazorpaySandboxProvider(
            key_id=settings.RAZORPAY_KEY_ID,
            key_secret=settings.RAZORPAY_KEY_SECRET,
            base_url=settings.RAZORPAY_BASE_URL,
        )

    return MockPaymentProvider()
