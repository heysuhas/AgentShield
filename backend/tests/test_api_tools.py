import pytest
from fastapi.testclient import TestClient

from app.api.v1.tools import _payment_provider, _shield
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_api_shield_state():
    _shield.reset_session_spend("session_123")
    _payment_provider.reset()
    yield
    _shield.reset_session_spend("session_123")
    _payment_provider.reset()


def test_api_execute_allowed_create_order() -> None:
    response = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": 4999, "category": "footwear"},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "ALLOW"
    assert data["session_id"] == "session_123"
    assert data["tool_name"] == "create_order"
    assert data["risk_score"] == 0.0
    assert data["reasons"] == []
    assert data["policy_violations"] == []
    assert data["provider_result"] is not None
    assert data["provider_result"]["success"] is True
    assert data["provider_result"]["order"]["id"] == "order_mock_000001"
    assert data["provider_result"]["order"]["amount"] == 4999


def test_api_execute_blocked_disallowed_tool() -> None:
    response = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_payout",
            "arguments": {"amount": 100},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "BLOCK"
    assert data["session_id"] == "session_123"
    assert data["tool_name"] == "create_payout"
    assert data["risk_score"] == 1.0
    assert "TOOL_NOT_ALLOWED" in data["reasons"]
    assert len(data["policy_violations"]) == 1
    assert data["policy_violations"][0]["rule"] == "TOOL_NOT_ALLOWED"
    assert data["provider_result"] is None


def test_api_execute_blocked_amount_above_limit() -> None:
    response = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": 5001},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "BLOCK"
    assert data["session_id"] == "session_123"
    assert data["tool_name"] == "create_order"
    assert data["risk_score"] == 1.0
    assert "MAX_TRANSACTION_AMOUNT" in data["reasons"]
    assert len(data["policy_violations"]) == 1
    assert data["policy_violations"][0]["rule"] == "MAX_TRANSACTION_AMOUNT"
    assert data["policy_violations"][0]["actual"] == 5001
    assert data["policy_violations"][0]["limit"] == 5000


def test_api_execute_blocked_malformed_amount() -> None:
    response = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": "invalid"},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "BLOCK"
    assert "INVALID_AMOUNT" in data["reasons"]
    assert data["policy_violations"][0]["actual"] == "invalid"


def test_api_execute_aggregate_session_spending_blocked() -> None:
    # 1. First order: ₹4,900 -> ALLOW (session spend = 4900)
    r1 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": 4900, "category": "electronics"},
        },
    )
    assert r1.status_code == 200
    assert r1.json()["decision"] == "ALLOW"

    # 2. Second order: ₹4,800 -> ALLOW (session spend = 9700)
    r2 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": 4800, "category": "electronics"},
        },
    )
    assert r2.status_code == 200
    assert r2.json()["decision"] == "ALLOW"

    # 3. Third order: ₹4,700 -> BLOCK (cumulative spend: 9700 + 4700 = 14400 > 10000)
    r3 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": 4700, "category": "electronics"},
        },
    )
    assert r3.status_code == 200
    data = r3.json()
    assert data["decision"] == "BLOCK"
    assert "MAX_SESSION_SPEND" in data["reasons"]
    assert len(data["policy_violations"]) == 1
    assert data["policy_violations"][0]["rule"] == "MAX_SESSION_SPEND"
    assert data["policy_violations"][0]["actual"] == 14400
    assert data["policy_violations"][0]["limit"] == 10000


def test_api_execute_blocked_unknown_session() -> None:
    response = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "unknown_session_999",
            "tool_name": "create_order",
            "arguments": {"amount": 1000},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "BLOCK"
    assert data["session_id"] == "unknown_session_999"
    assert data["tool_name"] == "create_order"
    assert data["risk_score"] == 1.0
    assert "POLICY_NOT_FOUND" in data["reasons"]
    assert len(data["policy_violations"]) == 1
    assert data["policy_violations"][0]["rule"] == "POLICY_NOT_FOUND"
    assert data["policy_violations"][0]["actual"] == "unknown_session_999"


def test_health_endpoint_remains_functional() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
