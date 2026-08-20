import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
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
    Base.metadata.drop_all(bind=engine)


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
    assert data["committed_spend"] == 0
    assert data["reserved_spend"] == 0
    assert data["total_active_spend"] == 0

    # 2. Get the session
    get_res = client.get("/api/v1/sessions/test_agent_session")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["session_id"] == "test_agent_session"
    assert get_data["policy"]["max_transaction_amount"] == 3000


def test_create_duplicate_session_returns_409() -> None:
    res1 = client.post(
        "/api/v1/sessions",
        json={"session_id": "dup_session"},
    )
    assert res1.status_code == 201

    res2 = client.post(
        "/api/v1/sessions",
        json={"session_id": "dup_session"},
    )
    assert res2.status_code == 409
    assert "already exists" in res2.json()["detail"]


def test_get_nonexistent_session_returns_404() -> None:
    res = client.get("/api/v1/sessions/missing_session_id")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"]


def test_session_policy_update_and_tool_execution() -> None:
    # 1. Create a session with tight policy
    client.post(
        "/api/v1/sessions",
        json={
            "session_id": "dynamic_session",
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 1000,
                "max_session_spend": 2000,
            },
        },
    )

    # 2. Tool request with amount 2500 should be BLOCKED
    exec_res1 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "dynamic_session",
            "tool_name": "create_order",
            "arguments": {"amount": 2500},
        },
    )
    assert exec_res1.status_code == 200
    assert exec_res1.json()["decision"] == "BLOCK"

    # 3. Update session policy limit to 5000
    update_res = client.put(
        "/api/v1/sessions/dynamic_session/policy",
        json={
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 10000,
            }
        },
    )
    assert update_res.status_code == 200
    assert update_res.json()["policy"]["max_transaction_amount"] == 5000

    # 4. Same tool request with amount 2500 should now be ALLOWED
    exec_res2 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "dynamic_session",
            "tool_name": "create_order",
            "arguments": {"amount": 2500},
        },
    )
    assert exec_res2.status_code == 200
    assert exec_res2.json()["decision"] == "ALLOW"

    # 5. Check updated spend metrics in session details
    session_res = client.get("/api/v1/sessions/dynamic_session")
    assert session_res.status_code == 200
    assert session_res.json()["committed_spend"] == 2500
    assert session_res.json()["total_active_spend"] == 2500


def test_reset_session_spend() -> None:
    client.post(
        "/api/v1/sessions",
        json={
            "session_id": "spend_session",
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 5000,
            },
        },
    )

    # Execute order 4000
    client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "spend_session",
            "tool_name": "create_order",
            "arguments": {"amount": 4000},
        },
    )

    # Next 2000 is blocked due to max_session_spend
    res_blocked = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "spend_session",
            "tool_name": "create_order",
            "arguments": {"amount": 2000},
        },
    )
    assert res_blocked.json()["decision"] == "BLOCK"

    # Reset session spend
    reset_res = client.post("/api/v1/sessions/spend_session/reset")
    assert reset_res.status_code == 200
    assert reset_res.json()["total_active_spend"] == 0

    # 2000 is now allowed
    res_allowed = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "spend_session",
            "tool_name": "create_order",
            "arguments": {"amount": 2000},
        },
    )
    assert res_allowed.json()["decision"] == "ALLOW"


def test_delete_session() -> None:
    client.post(
        "/api/v1/sessions",
        json={"session_id": "to_delete"},
    )

    del_res = client.delete("/api/v1/sessions/to_delete")
    assert del_res.status_code == 204

    get_res = client.get("/api/v1/sessions/to_delete")
    assert get_res.status_code == 404


def test_session_intent_lifecycle_and_tool_execution() -> None:
    # 1. Create a session with authorized intent for footwear
    create_res = client.post(
        "/api/v1/sessions",
        json={
            "session_id": "shopping_user_01",
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 10000,
            },
            "intent": {
                "category": "footwear",
                "purpose": "running shoes",
                "max_amount": 5000,
                "currency": "INR",
            },
        },
    )
    assert create_res.status_code == 201
    assert create_res.json()["intent"]["category"] == "footwear"
    assert create_res.json()["intent"]["purpose"] == "running shoes"

    # 2. Tool request with category='gift_card' -> BLOCK (Intent violation)
    exec_res1 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "shopping_user_01",
            "tool_name": "create_order",
            "arguments": {"amount": 4999, "category": "gift_card"},
        },
    )
    assert exec_res1.status_code == 200
    data1 = exec_res1.json()
    assert data1["decision"] == "BLOCK"
    assert "INTENT_CATEGORY_MISMATCH" in data1["reasons"]
    assert data1["intent_validation"]["category_match"] is False

    # 3. Update intent to allow gift_card
    update_res = client.put(
        "/api/v1/sessions/shopping_user_01/intent",
        json={
            "intent": {
                "category": "gift_card",
                "max_amount": 5000,
                "currency": "INR",
            }
        },
    )
    assert update_res.status_code == 200
    assert update_res.json()["intent"]["category"] == "gift_card"

    # 4. Same tool request now allowed
    exec_res2 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "shopping_user_01",
            "tool_name": "create_order",
            "arguments": {"amount": 4999, "category": "gift_card"},
        },
    )
    assert exec_res2.status_code == 200
    assert exec_res2.json()["decision"] == "ALLOW"
