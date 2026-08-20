import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.agentshield.approval import ApprovalStatus, InMemoryApprovalStore
from app.agentshield.audit import InMemoryAuditSink
from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy
from app.agentshield.transaction import InMemoryTransactionStore, TransactionStatus
from app.api.deps import get_db
from app.db.models import SessionModel
from app.db.session import Base
from app.db.stores import (
    SqlAlchemyApprovalStore,
    SqlAlchemyAuditSink,
    SqlAlchemyIntentProvider,
    SqlAlchemyPolicyProvider,
    SqlAlchemyTransactionStore,
)
from app.main import app
from app.providers.payments.mock import MockPaymentProvider


def test_human_approval_triggered_by_amount_threshold() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5000,
        max_session_spend=10000,
        require_approval_above=3000,
    )
    provider = MockPaymentProvider()
    txn_store = InMemoryTransactionStore()
    appr_store = InMemoryApprovalStore()
    audit_sink = InMemoryAuditSink()

    shield = AgentShield(
        policy,
        payment_provider=provider,
        transaction_store=txn_store,
        approval_store=appr_store,
        audit_sink=audit_sink,
    )

    # ₹3,500 exceeds require_approval_above=3000 -> triggers REVIEW
    res = shield.execute_tool(
        session_id="s_appr",
        tool_name="create_order",
        arguments={"amount": 3500},
    )

    assert res.decision == "REVIEW"
    assert res.transaction_status == TransactionStatus.PENDING
    assert res.approval_id is not None
    assert "REQUIRES_HUMAN_APPROVAL" in res.reasons

    # Verify spend is reserved but not committed
    assert shield.get_committed_spend("s_appr") == 0
    assert shield.get_reserved_spend("s_appr") == 3500

    # Provider must NOT have been called yet
    assert len(provider._orders) == 0


def test_human_approval_approved_and_executed() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5000,
        max_session_spend=10000,
        require_approval_above=3000,
    )
    provider = MockPaymentProvider()
    txn_store = InMemoryTransactionStore()
    appr_store = InMemoryApprovalStore()
    audit_sink = InMemoryAuditSink()

    shield = AgentShield(
        policy,
        payment_provider=provider,
        transaction_store=txn_store,
        approval_store=appr_store,
        audit_sink=audit_sink,
    )

    res = shield.execute_tool(
        session_id="s_appr_ok",
        tool_name="create_order",
        arguments={"amount": 3500},
    )
    assert res.decision == "REVIEW"
    approval_id = res.approval_id
    assert approval_id is not None

    # Human operator authorizes transaction
    approve_res = shield.approve_transaction(
        approval_id,
        reviewed_by="security_admin",
        review_notes="Approved for team equipment",
    )

    assert approve_res.decision == "ALLOW"
    assert approve_res.transaction_status == TransactionStatus.SUCCEEDED
    assert approve_res.provider_result is not None
    assert approve_res.provider_result.success is True

    # Spend is now settled
    assert shield.get_committed_spend("s_appr_ok") == 3500
    assert shield.get_reserved_spend("s_appr_ok") == 0

    # Approval state is APPROVED
    saved_appr = appr_store.get(approval_id)
    assert saved_appr is not None
    assert saved_appr.status == ApprovalStatus.APPROVED
    assert saved_appr.reviewed_by == "security_admin"


def test_human_approval_rejected_and_cancelled() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5000,
        max_session_spend=10000,
        require_approval_above=3000,
    )
    provider = MockPaymentProvider()
    shield = AgentShield(
        policy,
        payment_provider=provider,
        transaction_store=InMemoryTransactionStore(),
        approval_store=InMemoryApprovalStore(),
        audit_sink=InMemoryAuditSink(),
    )

    res = shield.execute_tool(
        session_id="s_appr_rej",
        tool_name="create_order",
        arguments={"amount": 3500},
    )
    assert res.decision == "REVIEW"
    approval_id = res.approval_id
    assert approval_id is not None

    # Human operator rejects transaction
    rej_res = shield.reject_transaction(
        approval_id,
        reviewed_by="fraud_ops",
        review_notes="Suspicious activity pattern",
    )

    assert rej_res.decision == "BLOCK"
    assert rej_res.transaction_status == TransactionStatus.CANCELLED

    # Reserved spend released back to 0!
    assert shield.get_committed_spend("s_appr_rej") == 0
    assert shield.get_reserved_spend("s_appr_rej") == 0
    assert len(provider._orders) == 0


def test_approvals_api_endpoints() -> None:
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

    # 1. Create a session with require_human_approval=True
    client.post(
        "/api/v1/sessions",
        json={
            "session_id": "s_api_appr",
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "require_human_approval": True,
            },
        },
    )

    # 2. Trigger tool execution -> returns REVIEW
    exec_resp = client.post(
        "/api/v1/tools/execute",
        json={
            "session_id": "s_api_appr",
            "tool_name": "create_order",
            "arguments": {"amount": 2000},
        },
    )
    assert exec_resp.status_code == 200
    data = exec_resp.json()
    assert data["decision"] == "REVIEW"
    appr_id = data["approval_id"]
    assert appr_id is not None

    # 3. List approvals
    list_resp = client.get("/api/v1/approvals?status=PENDING")
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert list_data["total"] >= 1
    assert any(item["approval_id"] == appr_id for item in list_data["items"])

    # 4. Get single approval
    single_resp = client.get(f"/api/v1/approvals/{appr_id}")
    assert single_resp.status_code == 200
    assert single_resp.json()["approval_id"] == appr_id

    # 5. Approve transaction
    approve_resp = client.post(
        f"/api/v1/approvals/{appr_id}/approve",
        json={
            "reviewed_by": "lead_auditor",
            "review_notes": "Verified authentic vendor",
        },
    )
    assert approve_resp.status_code == 200
    appr_data = approve_resp.json()
    assert appr_data["decision"] == "ALLOW"
    assert appr_data["transaction_status"] == "SUCCEEDED"

    # 6. Attempting to approve again fails (400 Bad Request)
    dup_resp = client.post(f"/api/v1/approvals/{appr_id}/approve")
    assert dup_resp.status_code == 400

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
