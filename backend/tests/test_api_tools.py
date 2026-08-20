import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.api.v1.tools import DEMO_POLICY
from app.db.session import Base
from app.db.stores import SqlAlchemyPolicyProvider
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

    # Provision demo session
    db = TestingSessionLocal()
    policy_prov = SqlAlchemyPolicyProvider(db)
    policy_prov.set_policy("session_123", DEMO_POLICY)
    db.close()

    yield

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


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
    assert data["provider_result"]["order"]["amount"] == 4999
    assert data["transaction_id"].startswith("txn_")
    assert data["transaction_status"] == "SUCCEEDED"


def test_api_execute_blocked_disallowed_tool() -> None:
    response = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_payout",
            "arguments": {"amount": 1000},
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
    assert data["transaction_id"].startswith("txn_")
    assert data["transaction_status"] == "BLOCKED"


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
    assert data["policy_violations"][0]["limit"] == 5000
    assert data["policy_violations"][0]["actual"] == 5001
    assert data["provider_result"] is None
    assert data["transaction_id"].startswith("txn_")
    assert data["transaction_status"] == "BLOCKED"


def test_api_execute_blocked_malformed_amount() -> None:
    response = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": "invalid_number"},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "BLOCK"
    assert data["session_id"] == "session_123"
    assert data["tool_name"] == "create_order"
    assert data["risk_score"] == 1.0
    assert "INVALID_AMOUNT" in data["reasons"]
    assert data["provider_result"] is None
    assert data["transaction_id"].startswith("txn_")
    assert data["transaction_status"] == "BLOCKED"


def test_api_execute_aggregate_session_spending_blocked() -> None:
    res1 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": 4900},
        },
    )
    assert res1.status_code == 200
    assert res1.json()["decision"] == "ALLOW"

    res2 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": 4800},
        },
    )
    assert res2.status_code == 200
    assert res2.json()["decision"] == "ALLOW"

    res3 = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "session_123",
            "tool_name": "create_order",
            "arguments": {"amount": 4700},
        },
    )
    assert res3.status_code == 200
    data3 = res3.json()
    assert data3["decision"] == "BLOCK"
    assert "MAX_SESSION_SPEND" in data3["reasons"]
    assert data3["provider_result"] is None


def test_api_execute_blocked_unknown_session() -> None:
    response = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "unknown_session_xyz",
            "tool_name": "create_order",
            "arguments": {"amount": 1000},
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["decision"] == "BLOCK"
    assert "POLICY_NOT_FOUND" in data["reasons"]
    assert data["provider_result"] is None


def test_health_endpoint_remains_functional() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
