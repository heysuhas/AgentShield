from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy
from app.agentshield.transaction import (
    InMemoryTransactionStore,
    TransactionRecord,
    TransactionStatus,
)
from app.db.models import TransactionModel
from app.db.session import Base
from app.db.stores import (
    SqlAlchemyAuditSink,
    SqlAlchemyIntentProvider,
    SqlAlchemyPolicyProvider,
    SqlAlchemyTransactionStore,
)
from app.providers.payments.mock import MockPaymentProvider


@pytest.fixture
def db_session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=engine
    )
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def test_in_memory_reservation_expiry() -> None:
    store = InMemoryTransactionStore()

    # Create transaction
    txn = store.create(
        session_id="sess_exp_01",
        tool_name="create_order",
        amount=3000,
        status=TransactionStatus.AUTHORIZED,
        decision="ALLOW",
    )
    assert store.get_reserved_spend("sess_exp_01") == 3000

    # Backdate created_at by 400 seconds
    old_time = datetime.now(timezone.utc) - timedelta(seconds=400)
    store._transactions[txn.transaction_id] = txn.model_copy(
        update={"created_at": old_time}
    )

    # Expire stale reservations older than 300 seconds
    expired = store.expire_stale_reservations(max_age_seconds=300)
    assert len(expired) == 1
    assert expired[0].transaction_id == txn.transaction_id
    assert expired[0].status == TransactionStatus.CANCELLED
    assert expired[0].error == "RESERVATION_EXPIRED"

    # Reserved spend is released
    assert store.get_reserved_spend("sess_exp_01") == 0


def test_sqlalchemy_reservation_expiry(db_session: Session) -> None:
    store = SqlAlchemyTransactionStore(db_session)

    # Create transaction
    txn = store.create(
        session_id="sess_sql_exp",
        tool_name="create_order",
        amount=4000,
        status=TransactionStatus.AUTHORIZED,
        decision="ALLOW",
    )
    assert store.get_reserved_spend("sess_sql_exp") == 4000

    # Backdate transaction in DB
    model = db_session.get(TransactionModel, txn.transaction_id)
    assert model is not None
    model.created_at = datetime.now(timezone.utc) - timedelta(seconds=600)
    db_session.commit()

    # Expire stale reservations
    expired = store.expire_stale_reservations(max_age_seconds=300)
    assert len(expired) == 1
    assert expired[0].transaction_id == txn.transaction_id
    assert expired[0].status == TransactionStatus.CANCELLED
    assert expired[0].error == "RESERVATION_EXPIRED"

    # Reserved spend is released
    assert store.get_reserved_spend("sess_sql_exp") == 0


def test_executor_reconciliation_audit_generation(db_session: Session) -> None:
    policy_provider = SqlAlchemyPolicyProvider(db_session)
    policy_provider.set_policy(
        "sess_recon",
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
            max_session_spend=5000,
        ),
    )
    txn_store = SqlAlchemyTransactionStore(db_session)
    audit_sink = SqlAlchemyAuditSink(db_session)
    intent_provider = SqlAlchemyIntentProvider(db_session)
    payment_provider = MockPaymentProvider()

    shield = AgentShield(
        policy_or_provider=policy_provider,
        payment_provider=payment_provider,
        transaction_store=txn_store,
        audit_sink=audit_sink,
        intent_provider=intent_provider,
    )

    # 1. Manually insert stranded AUTHORIZED transaction (e.g. from crash)
    txn = txn_store.create(
        session_id="sess_recon",
        tool_name="create_order",
        amount=4500,
        status=TransactionStatus.AUTHORIZED,
        decision="ALLOW",
    )
    # Backdate created_at
    model = db_session.get(TransactionModel, txn.transaction_id)
    assert model is not None
    model.created_at = datetime.now(timezone.utc) - timedelta(seconds=500)
    db_session.commit()

    # New transaction of 2000 is blocked because 4500 is reserved against 5000 limit
    res_blocked = shield.execute_tool(
        session_id="sess_recon",
        tool_name="create_order",
        arguments={"amount": 2000},
    )
    assert res_blocked.decision == "BLOCK"
    assert "MAX_SESSION_SPEND" in res_blocked.reasons

    # 2. Run reconciliation job
    reconciled = shield.reconcile_stale_reservations(max_age_seconds=300)
    assert len(reconciled) == 1
    assert reconciled[0].transaction_id == txn.transaction_id

    # 3. Check audit log for expiration event
    audit_events = audit_sink.list_by_session("sess_recon")
    # Newest events first
    assert any(
        "RESERVATION_EXPIRED" in e.reasons and e.transaction_status == TransactionStatus.CANCELLED
        for e in audit_events
    )

    # 4. Now that stale reservation is cancelled, the 2000 order can be authorized!
    res_allowed = shield.execute_tool(
        session_id="sess_recon",
        tool_name="create_order",
        arguments={"amount": 2000},
    )
    assert res_allowed.decision == "ALLOW"
    assert res_allowed.transaction_status == TransactionStatus.SUCCEEDED
    assert shield.get_committed_spend("sess_recon") == 2000
