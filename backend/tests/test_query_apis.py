import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.db.models import AuditEventModel, SessionModel, TransactionModel
from app.db.session import Base
from app.main import app


@pytest.fixture
def client_with_db():
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
    client = TestClient(app)

    # Seed data
    db = TestingSessionLocal()
    sess1 = SessionModel(session_id="s_query_1", status="ACTIVE")
    sess2 = SessionModel(session_id="s_query_2", status="ACTIVE")
    db.add_all([sess1, sess2])
    db.commit()

    # Seed transactions
    t1 = TransactionModel(
        transaction_id="txn_q_01",
        session_id="s_query_1",
        tool_name="create_order",
        amount=1000,
        currency="INR",
        status="SUCCEEDED",
        decision="ALLOW",
        reasons=[],
        arguments={"amount": 1000},
    )
    t2 = TransactionModel(
        transaction_id="txn_q_02",
        session_id="s_query_1",
        tool_name="create_order",
        amount=8000,
        currency="INR",
        status="BLOCKED",
        decision="BLOCK",
        reasons=["MAX_TRANSACTION_AMOUNT"],
        arguments={"amount": 8000},
    )
    t3 = TransactionModel(
        transaction_id="txn_q_03",
        session_id="s_query_2",
        tool_name="create_order",
        amount=2000,
        currency="INR",
        status="SUCCEEDED",
        decision="ALLOW",
        reasons=[],
        arguments={"amount": 2000},
    )
    db.add_all([t1, t2, t3])

    # Seed audit events
    e1 = AuditEventModel(
        event_id="evt_q_01",
        transaction_id="txn_q_01",
        transaction_status="SUCCEEDED",
        session_id="s_query_1",
        tool_name="create_order",
        arguments={"amount": 1000},
        decision="ALLOW",
        risk_score=0.0,
        risk_level="LOW",
        reasons=[],
        policy_violations=[],
    )
    e2 = AuditEventModel(
        event_id="evt_q_02",
        transaction_id="txn_q_02",
        transaction_status="BLOCKED",
        session_id="s_query_1",
        tool_name="create_order",
        arguments={"amount": 8000},
        decision="BLOCK",
        risk_score=1.0,
        risk_level="CRITICAL",
        reasons=["MAX_TRANSACTION_AMOUNT"],
        policy_violations=[],
    )
    db.add_all([e1, e2])
    db.commit()
    db.close()

    yield client

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def test_list_audit_events_and_filtering(client_with_db: TestClient) -> None:
    # 1. List all
    resp = client_with_db.get("/api/v1/audit")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2

    # 2. Filter by decision
    resp_block = client_with_db.get("/api/v1/audit?decision=BLOCK")
    assert resp_block.status_code == 200
    data_block = resp_block.json()
    assert data_block["total"] == 1
    assert data_block["items"][0]["event_id"] == "evt_q_02"
    assert data_block["items"][0]["risk_level"] == "CRITICAL"

    # 3. Filter by risk_level
    resp_low = client_with_db.get("/api/v1/audit?risk_level=LOW")
    assert resp_low.status_code == 200
    assert resp_low.json()["total"] == 1
    assert resp_low.json()["items"][0]["event_id"] == "evt_q_01"

    # 4. Get single event
    resp_single = client_with_db.get("/api/v1/audit/evt_q_01")
    assert resp_single.status_code == 200
    assert resp_single.json()["event_id"] == "evt_q_01"

    # 5. Non-existent event -> 404
    resp_404 = client_with_db.get("/api/v1/audit/evt_nonexistent")
    assert resp_404.status_code == 404


def test_list_transactions_and_filtering(client_with_db: TestClient) -> None:
    # 1. List all
    resp = client_with_db.get("/api/v1/transactions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert len(data["items"]) == 3

    # 2. Filter by session_id
    resp_sess = client_with_db.get("/api/v1/transactions?session_id=s_query_2")
    assert resp_sess.status_code == 200
    data_sess = resp_sess.json()
    assert data_sess["total"] == 1
    assert data_sess["items"][0]["transaction_id"] == "txn_q_03"

    # 3. Filter by status
    resp_status = client_with_db.get("/api/v1/transactions?status=BLOCKED")
    assert resp_status.status_code == 200
    assert resp_status.json()["total"] == 1
    assert resp_status.json()["items"][0]["transaction_id"] == "txn_q_02"

    # 4. Pagination
    resp_page = client_with_db.get("/api/v1/transactions?limit=2&offset=1")
    assert resp_page.status_code == 200
    data_page = resp_page.json()
    assert data_page["total"] == 3
    assert len(data_page["items"]) == 2

    # 5. Get single transaction
    resp_single = client_with_db.get("/api/v1/transactions/txn_q_01")
    assert resp_single.status_code == 200
    assert resp_single.json()["transaction_id"] == "txn_q_01"

    # 6. Non-existent transaction -> 404
    resp_404 = client_with_db.get("/api/v1/transactions/txn_nonexistent")
    assert resp_404.status_code == 404
