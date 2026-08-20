from datetime import datetime, timedelta, timezone
from typing import Any
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.agentshield.audit import InMemoryAuditSink
from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy
from app.agentshield.policy_provider import InMemoryPolicyProvider
from app.agentshield.transaction import (
    InMemoryTransactionStore,
    TransactionRecord,
    TransactionStatus,
)
from app.api.deps import get_db, get_payment_provider
from app.db.models import TransactionModel
from app.db.session import Base
from app.db.stores import (
    SqlAlchemyAuditSink,
    SqlAlchemyIntentProvider,
    SqlAlchemyPolicyProvider,
    SqlAlchemyTransactionStore,
)
from app.main import app
from app.providers.payments.base import PaymentOrder, PaymentResult
from app.providers.payments.mock import MockPaymentProvider


def test_idempotent_receipt_passed_to_provider() -> None:
    """Verifies that the transaction_id is passed as receipt for provider idempotency."""
    captured_receipts = []

    class MockIdempotentProvider(MockPaymentProvider):
        def create_order(
            self,
            *,
            amount: int,
            currency: str = "INR",
            receipt: str | None = None,
            notes: dict[str, Any] | None = None,
        ) -> PaymentResult:
            captured_receipts.append(receipt)
            return super().create_order(
                amount=amount, currency=currency, receipt=receipt, notes=notes
            )

    provider = MockIdempotentProvider()
    policy_prov = InMemoryPolicyProvider(
        policies={
            "s1": Policy(
                allowed_tools=frozenset({"create_order"}),
                max_transaction_amount=5000,
                max_session_spend=5000,
            )
        }
    )
    store = InMemoryTransactionStore()
    shield = AgentShield(
        policy_or_provider=policy_prov,
        payment_provider=provider,
        transaction_store=store,
        audit_sink=InMemoryAuditSink(),
    )

    res = shield.execute_tool(
        session_id="s1",
        tool_name="create_order",
        arguments={"amount": 2000},
    )
    assert res.decision == "ALLOW"
    assert len(captured_receipts) == 1
    assert captured_receipts[0] == res.transaction_id


def test_race_condition_expiration_during_slow_provider_call() -> None:
    """If a transaction is expired while provider is executing, transition to SUCCEEDED is blocked."""
    store = InMemoryTransactionStore()

    class SlowProvider(MockPaymentProvider):
        def create_order(
            self,
            *,
            amount: int,
            currency: str = "INR",
            receipt: str | None = None,
            notes: dict[str, Any] | None = None,
        ) -> PaymentResult:
            # Simulate a reconciliation job expiring this reservation while provider is in-flight
            txns = list(store._transactions.values())
            if txns:
                store.update_status(
                    txns[0].transaction_id,
                    status=TransactionStatus.CANCELLED,
                    error="RESERVATION_EXPIRED",
                )
            return super().create_order(
                amount=amount, currency=currency, receipt=receipt, notes=notes
            )

    policy_prov = InMemoryPolicyProvider(
        policies={
            "s_slow": Policy(
                allowed_tools=frozenset({"create_order"}),
                max_transaction_amount=5000,
                max_session_spend=5000,
            )
        }
    )
    shield = AgentShield(
        policy_or_provider=policy_prov,
        payment_provider=SlowProvider(),
        transaction_store=store,
        audit_sink=InMemoryAuditSink(),
    )

    res = shield.execute_tool(
        session_id="s_slow",
        tool_name="create_order",
        arguments={"amount": 2500},
    )

    # Must fail closed: cannot succeed an already cancelled transaction!
    assert res.decision == "BLOCK"
    assert res.transaction_status == TransactionStatus.CANCELLED
    assert store.get_committed_spend("s_slow") == 0


def test_provider_aware_crash_reconciliation() -> None:
    """Stale transaction with a valid provider order is reconciled to SUCCEEDED."""
    provider = MockPaymentProvider()
    # Create an order directly in provider to simulate pre-crash order creation
    prov_res = provider.create_order(amount=3000)
    assert prov_res.order is not None
    order_id = prov_res.order.id

    store = InMemoryTransactionStore()
    audit_sink = InMemoryAuditSink()
    policy_prov = InMemoryPolicyProvider(
        policies={
            "s_crash": Policy(
                allowed_tools=frozenset({"create_order"}),
                max_transaction_amount=5000,
                max_session_spend=5000,
            )
        }
    )

    # Stranded AUTHORIZED transaction with provider_order_id
    txn = store.create(
        session_id="s_crash",
        tool_name="create_order",
        amount=3000,
        status=TransactionStatus.AUTHORIZED,
        decision="ALLOW",
    )
    # Backdate and attach provider_order_id
    old_time = datetime.now(timezone.utc) - timedelta(seconds=500)
    store._transactions[txn.transaction_id] = txn.model_copy(
        update={"created_at": old_time, "provider_order_id": order_id}
    )

    shield = AgentShield(
        policy_or_provider=policy_prov,
        payment_provider=provider,
        transaction_store=store,
        audit_sink=audit_sink,
    )

    # Reconcile stale reservations
    reconciled = shield.reconcile_stale_reservations(max_age_seconds=300)
    assert len(reconciled) == 1
    assert reconciled[0].transaction_id == txn.transaction_id

    # Verify audit trail contains RECONCILED_FROM_PROVIDER
    events = audit_sink.list_by_session("s_crash")
    assert any("RECONCILED_FROM_PROVIDER" in e.reasons for e in events)


def test_reconciliation_api_endpoints() -> None:
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

    # Create session
    client.post(
        "/api/v1/sessions",
        json={
            "session_id": "sess_api_recon",
            "policy": {
                "allowed_tools": ["create_order"],
                "max_transaction_amount": 5000,
                "max_session_spend": 5000,
            },
        },
    )

    # Call /api/v1/sessions/reconcile
    resp = client.post("/api/v1/sessions/reconcile?max_age_seconds=300")
    assert resp.status_code == 200
    data = resp.json()
    assert "reconciled_count" in data

    # Call /api/v1/sessions/{id}/reconcile
    resp_sess = client.post("/api/v1/sessions/sess_api_recon/reconcile")
    assert resp_sess.status_code == 200
    assert resp_sess.json()["session_id"] == "sess_api_recon"

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
