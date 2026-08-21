"""Tests for payments configuration and signature verification endpoints."""

import hashlib
import hmac
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.db.session import Base
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=engine
    )

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()


def test_payment_config_endpoint():
    """Verify /api/v1/payments/config returns public gateway settings."""
    response = client.get("/api/v1/payments/config")
    assert response.status_code == 200
    data = response.json()
    assert "provider" in data
    assert "currency" in data
    assert data["currency"] == "INR"
    assert data["sandbox_mode"] is True


def test_verify_payment_signature_success(monkeypatch):
    """Verify valid Razorpay signature commits transaction to SUCCEEDED."""
    session_id = "test_verify_sess_01"
    # Initialize session with policy and intent
    client.post(
        "/api/v1/sessions",
        json={
            "session_id": session_id,
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 10000,
            },
            "intent": {
                "category": "footwear",
                "purpose": "running shoes",
                "max_amount": 5000,
                "allowed_tools": ["create_order"],
            },
        },
    )

    # Execute an allowed tool
    tool_resp = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": session_id,
            "tool_name": "create_order",
            "arguments": {
                "amount": 1200,
                "currency": "INR",
                "category": "footwear",
                "purpose": "running shoes",
            },
        },
    )
    assert tool_resp.status_code == 200
    txn_id = tool_resp.json()["transaction_id"]

    # Mock secret and compute valid HMAC SHA256 signature
    secret = "test_secret_key_123"
    monkeypatch.setattr(
        "app.api.v1.payments.get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "RAZORPAY_KEY_SECRET": secret,
                "RAZORPAY_KEY_ID": "rzp_test_123",
                "PAYMENT_PROVIDER": "razorpay",
            },
        )(),
    )

    order_id = "order_test_8899"
    payment_id = "pay_test_9988"
    msg = f"{order_id}|{payment_id}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()

    verify_resp = client.post(
        "/api/v1/payments/verify",
        json={
            "session_id": session_id,
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": sig,
            "transaction_id": txn_id,
        },
    )
    assert verify_resp.status_code == 200
    res_data = verify_resp.json()
    assert res_data["verified"] is True
    assert res_data["status"] == "SUCCEEDED"
    assert res_data["transaction_id"] == txn_id


def test_verify_payment_signature_failure(monkeypatch):
    """Verify invalid signature is rejected with 400 and blocked audit event."""
    session_id = "test_verify_fail_01"
    client.post(
        "/api/v1/sessions",
        json={
            "session_id": session_id,
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 10000,
            },
            "intent": {
                "category": "footwear",
                "purpose": "running shoes",
                "max_amount": 5000,
                "allowed_tools": ["create_order"],
            },
        },
    )

    secret = "test_secret_key_123"
    monkeypatch.setattr(
        "app.api.v1.payments.get_settings",
        lambda: type(
            "Settings",
            (),
            {
                "RAZORPAY_KEY_SECRET": secret,
                "RAZORPAY_KEY_ID": "rzp_test_123",
                "PAYMENT_PROVIDER": "razorpay",
            },
        )(),
    )

    verify_resp = client.post(
        "/api/v1/payments/verify",
        json={
            "session_id": session_id,
            "razorpay_order_id": "order_123",
            "razorpay_payment_id": "pay_123",
            "razorpay_signature": "invalid_signature_hex",
        },
    )
    assert verify_resp.status_code == 400
    assert "failed" in verify_resp.json()["detail"]


def test_external_agent_execute_endpoint():
    """Verify /api/v1/agent/execute processes external agent tool calls."""
    session_id = "test_ext_agent_01"
    client.post(
        "/api/v1/sessions",
        json={
            "session_id": session_id,
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 10000,
            },
            "intent": {
                "category": "footwear",
                "purpose": "running shoes",
                "max_amount": 5000,
                "allowed_tools": ["create_order"],
            },
        },
    )

    resp = client.post(
        "/api/v1/agent/execute",
        json={
            "session_id": session_id,
            "tool_name": "create_order",
            "arguments": {
                "amount": 2500,
                "currency": "INR",
                "category": "footwear",
                "purpose": "running shoes",
            },
            "agent_id": "external_crewai_agent_99",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["decision"] == "ALLOW"
    assert data["tool_name"] == "create_order"
    assert data["transaction_id"] is not None
