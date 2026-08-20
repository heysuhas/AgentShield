from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.agentshield.audit import InMemoryAuditSink
from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy
from app.agentshield.policy_provider import InMemoryPolicyProvider
from app.agentshield.transaction import InMemoryTransactionStore
from app.db.models import TransactionModel
from app.db.session import Base
from app.db.stores import (
    SqlAlchemyAuditSink,
    SqlAlchemyIntentProvider,
    SqlAlchemyPolicyProvider,
    SqlAlchemyTransactionStore,
)
from app.providers.payments.mock import MockPaymentProvider


def test_velocity_request_frequency_limit() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5000,
        max_session_spend=50000,
        max_requests_per_window=3,
        window_seconds=60,
    )
    store = InMemoryTransactionStore()
    shield = AgentShield(
        policy,
        payment_provider=MockPaymentProvider(),
        transaction_store=store,
        audit_sink=InMemoryAuditSink(),
    )

    # 3 allowed requests within 60s
    for i in range(3):
        res = shield.execute_tool(
            session_id="s_vel",
            tool_name="create_order",
            arguments={"amount": 1000},
        )
        assert res.decision == "ALLOW"

    # 4th request in the same window must be BLOCKED
    res_blocked = shield.execute_tool(
        session_id="s_vel",
        tool_name="create_order",
        arguments={"amount": 1000},
    )
    assert res_blocked.decision == "BLOCK"
    assert "VELOCITY_REQUEST_LIMIT_EXCEEDED" in res_blocked.reasons
    assert res_blocked.risk_level == "CRITICAL"


def test_velocity_sliding_window_expiration() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5000,
        max_session_spend=50000,
        max_requests_per_window=3,
        window_seconds=60,
    )
    store = InMemoryTransactionStore()
    shield = AgentShield(
        policy,
        payment_provider=MockPaymentProvider(),
        transaction_store=store,
        audit_sink=InMemoryAuditSink(),
    )

    # Send 3 requests
    for i in range(3):
        res = shield.execute_tool(
            session_id="s_vel_exp",
            tool_name="create_order",
            arguments={"amount": 1000},
        )
        assert res.decision == "ALLOW"

    # Backdate the 3 transactions to simulate 70 seconds passing
    old_time = datetime.now(timezone.utc) - timedelta(seconds=70)
    for txn_id, txn in list(store._transactions.items()):
        store._transactions[txn_id] = txn.model_copy(update={"created_at": old_time})

    # Now a 4th request succeeds because the previous 3 have slid out of the 60s window
    res_after = shield.execute_tool(
        session_id="s_vel_exp",
        tool_name="create_order",
        arguments={"amount": 1000},
    )
    assert res_after.decision == "ALLOW"


def test_velocity_burst_spend_limit() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5000,
        max_session_spend=50000,
        max_spend_per_window=5000,
        window_seconds=60,
    )
    shield = AgentShield(
        policy,
        payment_provider=MockPaymentProvider(),
        transaction_store=InMemoryTransactionStore(),
        audit_sink=InMemoryAuditSink(),
    )

    # 1. Spend 3000 -> ALLOW
    r1 = shield.execute_tool(
        session_id="s_burst",
        tool_name="create_order",
        arguments={"amount": 3000},
    )
    assert r1.decision == "ALLOW"

    # 2. Attempt 2500 -> (3000 + 2500 = 5500 > 5000) -> BLOCK
    r2 = shield.execute_tool(
        session_id="s_burst",
        tool_name="create_order",
        arguments={"amount": 2500},
    )
    assert r2.decision == "BLOCK"
    assert "VELOCITY_SPEND_LIMIT_EXCEEDED" in r2.reasons


def test_velocity_database_persistence_and_enforcement() -> None:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=engine
    )
    db = TestingSessionLocal()

    policy_prov = SqlAlchemyPolicyProvider(db)
    policy_prov.set_policy(
        "s_db_vel",
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
            max_session_spend=50000,
            max_requests_per_window=2,
            window_seconds=60,
        ),
    )

    # Retrieve policy to confirm persistence of velocity fields
    saved = policy_prov.get_policy("s_db_vel")
    assert saved is not None
    assert saved.max_requests_per_window == 2
    assert saved.window_seconds == 60

    txn_store = SqlAlchemyTransactionStore(db)
    audit_sink = SqlAlchemyAuditSink(db)
    intent_prov = SqlAlchemyIntentProvider(db)

    shield = AgentShield(
        policy_or_provider=policy_prov,
        payment_provider=MockPaymentProvider(),
        transaction_store=txn_store,
        audit_sink=audit_sink,
        intent_provider=intent_prov,
    )

    # First 2 allowed
    assert (
        shield.execute_tool(
            session_id="s_db_vel",
            tool_name="create_order",
            arguments={"amount": 500},
        ).decision
        == "ALLOW"
    )
    assert (
        shield.execute_tool(
            session_id="s_db_vel",
            tool_name="create_order",
            arguments={"amount": 500},
        ).decision
        == "ALLOW"
    )

    # 3rd is blocked by velocity limit
    r3 = shield.execute_tool(
        session_id="s_db_vel",
        tool_name="create_order",
        arguments={"amount": 500},
    )
    assert r3.decision == "BLOCK"
    assert "VELOCITY_REQUEST_LIMIT_EXCEEDED" in r3.reasons

    db.close()
    Base.metadata.drop_all(bind=engine)
