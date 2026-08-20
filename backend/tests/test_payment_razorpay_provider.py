import json
import pytest
import httpx

from app.config import Settings
from app.providers.payments.base import PaymentProvider
from app.providers.payments.factory import get_payment_provider
from app.providers.payments.mock import MockPaymentProvider
from app.providers.payments.razorpay import RazorpaySandboxProvider


def test_razorpay_provider_conforms_to_protocol() -> None:
    provider = RazorpaySandboxProvider(key_id="rzp_test_key", key_secret="rzp_test_secret")
    assert isinstance(provider, PaymentProvider)


def test_razorpay_create_order_success() -> None:
    def custom_transport(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == "https://api.razorpay.com/v1/orders"
        assert request.headers["Authorization"].startswith("Basic ")
        data = json.loads(request.content)
        assert data["amount"] == 500000  # 5000 INR -> 500000 paise
        assert data["currency"] == "INR"
        assert data["receipt"] == "rcpt_test_01"

        return httpx.Response(
            201,
            json={
                "id": "order_EKwxwAgItmmXdp",
                "entity": "order",
                "amount": 500000,
                "amount_paid": 0,
                "amount_due": 500000,
                "currency": "INR",
                "receipt": "rcpt_test_01",
                "status": "created",
                "attempts": 0,
                "created_at": 1589970997,
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(custom_transport))
    provider = RazorpaySandboxProvider(
        key_id="rzp_test_key",
        key_secret="rzp_test_secret",
        client=client,
    )

    result = provider.create_order(
        amount=5000,
        currency="INR",
        receipt="rcpt_test_01",
        notes={"purpose": "running shoes"},
    )

    assert result.success is True
    assert result.order is not None
    assert result.order.id == "order_EKwxwAgItmmXdp"
    assert result.order.amount == 5000
    assert result.order.currency == "INR"
    assert result.order.status == "created"


def test_razorpay_create_order_auth_missing() -> None:
    provider = RazorpaySandboxProvider(key_id=None, key_secret=None)
    result = provider.create_order(amount=1000)
    assert result.success is False
    assert "credentials not configured" in (result.error or "")


def test_razorpay_create_order_401_error() -> None:
    def error_transport(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={
                "error": {
                    "code": "BAD_REQUEST_ERROR",
                    "description": "The id provided does not exist",
                }
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(error_transport))
    provider = RazorpaySandboxProvider(
        key_id="invalid_key",
        key_secret="invalid_secret",
        client=client,
    )

    result = provider.create_order(amount=2000)
    assert result.success is False
    assert "401" in (result.error or "")
    assert "The id provided does not exist" in (result.error or "")


def test_razorpay_fetch_order_success() -> None:
    def custom_transport(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert str(request.url) == "https://api.razorpay.com/v1/orders/order_EKwxwAgItmmXdp"

        return httpx.Response(
            200,
            json={
                "id": "order_EKwxwAgItmmXdp",
                "entity": "order",
                "amount": 250000,
                "amount_paid": 250000,
                "amount_due": 0,
                "currency": "INR",
                "receipt": "rcpt_fetch_01",
                "status": "paid",
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(custom_transport))
    provider = RazorpaySandboxProvider(
        key_id="rzp_test_key",
        key_secret="rzp_test_secret",
        client=client,
    )

    result = provider.fetch_order(order_id="order_EKwxwAgItmmXdp")
    assert result.success is True
    assert result.order is not None
    assert result.order.id == "order_EKwxwAgItmmXdp"
    assert result.order.amount == 2500
    assert result.order.status == "paid"


def test_payment_provider_factory(monkeypatch) -> None:
    get_payment_provider.cache_clear()

    # Default -> MockPaymentProvider
    provider = get_payment_provider()
    assert isinstance(provider, MockPaymentProvider)
