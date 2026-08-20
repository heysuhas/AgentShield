import pytest
from fastapi.testclient import TestClient

from app.api.v1.tools import _payment_provider, _policy_provider, _shield
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_state():
    _shield.reset()
    _payment_provider.reset()
    _policy_provider.reset()
    yield
    _shield.reset()
    _payment_provider.reset()
    _policy_provider.reset()


def test_create_and_get_session_lifecycle() -> None:
    # 1. Create a session with policy
    res = client.post(
        "/api/v1/sessions",
        json={
            "session_id": "test_agent_session",
            "policy": {
                "allowed_tools": ["create_order", "fetch_order"],
                "max_transaction_amount": 3000,
                "max_session_spend": 6000,
            },
        },
    )
    assert res.status_code == 201
    data = res.json()
    assert data["session_id"] == "test_agent_session"
    assert data["status"] == "ACTIVE"
    assert data["policy"]["allowed_tools"] == ["create_order", "fetch_order"]
    assert data["policy"]["max_transaction_amount"] == 3000
    assert data["policy"]["max_session_spend"] == 6000
    assert data["total_active_spend"] == 0

    # 2. Get session info
    get_res = client.get("/api/v1/sessions/test_agent_session")
    assert get_res.status_code == 200
    assert get_res.json()["session_id"] == "test_agent_session"


def test_create_duplicate_session_returns_409() -> None:
    client.post(
        "/api/v1/sessions",
        json={"session_id": "dup_session"},
    )
    dup_res = client.post(
        "/api/v1/sessions",
        json={"session_id": "dup_session"},
    )
    assert dup_res.status_code == 409
    assert "already exists" in dup_res.json()["detail"]


def test_get_nonexistent_session_returns_404() -> None:
    res = client.get("/api/v1/sessions/nonexistent_session")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_session_policy_update_and_tool_execution() -> None:
    # Create empty session
    client.post(
        "/api/v1/sessions",
        json={"session_id": "shopping_sess"},
    )

    # Set policy
    put_res = client.put(
        "/api/v1/sessions/shopping_sess/policy",
        json={
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 10000,
            }
        },
    )
    assert put_res.status_code == 200
    assert put_res.json()["policy"]["max_transaction_amount"] == 5000

    # Execute tool on this session
    exec_res = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "shopping_sess",
            "tool_name": "create_order",
            "arguments": {"amount": 2500},
        },
    )
    assert exec_res.status_code == 200
    assert exec_res.json()["decision"] == "ALLOW"

    # Verify session spend updated
    sess_res = client.get("/api/v1/sessions/shopping_sess")
    assert sess_res.status_code == 200
    assert sess_res.json()["committed_spend"] == 2500
    assert sess_res.json()["total_active_spend"] == 2500


def test_reset_session_spend() -> None:
    # Setup session with policy and spend
    client.post(
        "/api/v1/sessions",
        json={
            "session_id": "reset_sess",
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 10000,
            },
        },
    )
    client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "reset_sess",
            "tool_name": "create_order",
            "arguments": {"amount": 3500},
        },
    )

    # Reset spend
    reset_res = client.post("/api/v1/sessions/reset_sess/reset")
    assert reset_res.status_code == 200
    assert reset_res.json()["committed_spend"] == 0
    assert reset_res.json()["total_active_spend"] == 0


def test_delete_session() -> None:
    client.post(
        "/api/v1/sessions",
        json={"session_id": "del_sess"},
    )
    del_res = client.delete("/api/v1/sessions/del_sess")
    assert del_res.status_code == 204

    # Getting deleted session returns 404
    get_res = client.get("/api/v1/sessions/del_sess")
    assert get_res.status_code == 404
