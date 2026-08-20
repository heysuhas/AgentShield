import pytest

from app.providers.payments.base import PaymentProvider
from app.providers.payments.mock import MockPaymentProvider


def test_mock_payment_provider_conforms_to_protocol() -> None:
    provider = MockPaymentProvider()
    assert isinstance(provider, PaymentProvider)


def test_mock_create_order_generates_sequential_ids() -> None:
    provider = MockPaymentProvider()

    res1 = provider.create_order(
        amount=4999,
        currency="INR",
        receipt="rcpt_001",
        notes={"item": "shoes"},
    )
    assert res1.success is True
    assert res1.order is not None
    assert res1.order.id == "order_mock_000001"
    assert res1.order.amount == 4999
    assert res1.order.currency == "INR"
    assert res1.order.receipt == "rcpt_001"
    assert res1.order.notes == {"item": "shoes"}
    assert res1.order.status == "created"

    res2 = provider.create_order(amount=2500)
    assert res2.success is True
    assert res2.order is not None
    assert res2.order.id == "order_mock_000002"
    assert res2.order.amount == 2500


def test_mock_fetch_order_retrieves_created_order() -> None:
    provider = MockPaymentProvider()
    create_res = provider.create_order(amount=1500)
    assert create_res.order is not None
    order_id = create_res.order.id

    fetch_res = provider.fetch_order(order_id=order_id)
    assert fetch_res.success is True
    assert fetch_res.order is not None
    assert fetch_res.order.id == order_id
    assert fetch_res.order.amount == 1500


def test_mock_fetch_nonexistent_order_fails() -> None:
    provider = MockPaymentProvider()
    fetch_res = provider.fetch_order(order_id="order_nonexistent")
    assert fetch_res.success is False
    assert fetch_res.order is None
    assert "not found" in (fetch_res.error or "").lower()


def test_mock_simulate_failure_and_recovery() -> None:
    provider = MockPaymentProvider()

    # Simulate failure
    provider.simulate_failure(error="Razorpay API timeout")
    fail_res = provider.create_order(amount=1000)
    assert fail_res.success is False
    assert fail_res.error == "Razorpay API timeout"
    assert fail_res.order is None

    fetch_fail_res = provider.fetch_order(order_id="order_mock_000001")
    assert fetch_fail_res.success is False
    assert fetch_fail_res.error == "Razorpay API timeout"

    # Restore success
    provider.simulate_success()
    succ_res = provider.create_order(amount=1000)
    assert succ_res.success is True
    assert succ_res.order is not None


def test_mock_reset_clears_state() -> None:
    provider = MockPaymentProvider()
    res1 = provider.create_order(amount=500)
    assert res1.order is not None
    order_id = res1.order.id

    provider.reset()
    assert provider.fetch_order(order_id=order_id).success is False

    res2 = provider.create_order(amount=600)
    assert res2.order is not None
    assert res2.order.id == "order_mock_000001"
