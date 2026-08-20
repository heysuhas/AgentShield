import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.agentshield.executor import AgentShield
from app.agentshield.intent import AuthorizedIntent
from app.agentshield.policy_engine import Policy
from app.agentshield.transaction import TransactionStatus
from app.db.session import Base
from app.db.stores import (
    SqlAlchemyAuditSink,
    SqlAlchemyIntentProvider,
    SqlAlchemyPolicyProvider,
    SqlAlchemyTransactionStore,
)
from app.providers.payments.mock import MockPaymentProvider


@pytest.fixture
def db_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(db_engine) -> Session:
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=db_engine
    )
    session = TestingSessionLocal()
    yield session
    session.close()


def test_sqlalchemy_transaction_store_lifecycle_and_spend(
    db_session: Session,
) -> None:
    store = SqlAlchemyTransactionStore(db_session)

    # 1. Create transaction in REQUESTED state
    txn1 = store.create(
        session_id="sess_db_01",
        tool_name="create_order",
        amount=3000,
        status=TransactionStatus.REQUESTED,
        decision="ALLOW",
        arguments={"amount": 3000, "category": "electronics"},
    )
    assert txn1.transaction_id.startswith("txn_")
    assert txn1.status == TransactionStatus.REQUESTED

    # 2. Update to AUTHORIZED (reserves spend)
    store.update_status(txn1.transaction_id, TransactionStatus.AUTHORIZED)
    assert store.get_reserved_spend("sess_db_01") == 3000
    assert store.get_committed_spend("sess_db_01") == 0

    # 3. Update to SUCCEEDED (commits spend)
    store.update_status(
        txn1.transaction_id,
        TransactionStatus.SUCCEEDED,
        provider_order_id="order_mock_001",
    )
    assert store.get_reserved_spend("sess_db_01") == 0
    assert store.get_committed_spend("sess_db_01") == 3000

    # 4. Create second transaction in BLOCKED state (0 spend)
    txn2 = store.create(
        session_id="sess_db_01",
        tool_name="create_payout",
        amount=1000,
        status=TransactionStatus.BLOCKED,
        decision="BLOCK",
        reasons=["TOOL_NOT_ALLOWED"],
    )
    assert txn2.transaction_id.startswith("txn_")
    assert store.get_committed_spend("sess_db_01") == 3000

    # 5. List by session
    history = store.list_by_session("sess_db_01")
    assert len(history) == 2


def test_sqlalchemy_audit_sink(db_session: Session) -> None:
    sink = SqlAlchemyAuditSink(db_session)

    event = sink.create_and_record(
        transaction_id="txn_test_001",
        transaction_status=TransactionStatus.SUCCEEDED,
        session_id="sess_audit_01",
        tool_name="create_order",
        arguments={"amount": 1500},
        decision="ALLOW",
        risk_score=0.0,
        provider_name="MockPaymentProvider",
    )

    assert event.event_id.startswith("evt_")
    assert event.transaction_id == "txn_test_001"
    assert event.transaction_status == TransactionStatus.SUCCEEDED

    retrieved = sink.get(event.event_id)
    assert retrieved is not None
    assert retrieved.tool_name == "create_order"

    events = sink.list_by_session("sess_audit_01")
    assert len(events) == 1
    assert events[0].event_id == event.event_id


def test_sqlalchemy_policy_and_intent_providers(db_session: Session) -> None:
    policy_provider = SqlAlchemyPolicyProvider(db_session)
    intent_provider = SqlAlchemyIntentProvider(db_session)

    # 1. Register Policy
    policy = Policy(
        allowed_tools=frozenset({"create_order", "fetch_order"}),
        max_transaction_amount=4000,
        max_session_spend=8000,
    )
    policy_provider.set_policy("session_test", policy)

    assert policy_provider.has_session("session_test") is True
    loaded_policy = policy_provider.get_policy("session_test")
    assert loaded_policy is not None
    assert loaded_policy.max_transaction_amount == 4000
    assert "create_order" in loaded_policy.allowed_tools

    # 2. Register Intent
    intent = AuthorizedIntent(
        category="footwear",
        purpose="running shoes",
        max_amount=4000,
        currency="INR",
    )
    intent_provider.set_intent("session_test", intent)

    assert intent_provider.has_intent("session_test") is True
    loaded_intent = intent_provider.get_intent("session_test")
    assert loaded_intent is not None
    assert loaded_intent.category == "footwear"
    assert loaded_intent.purpose == "running shoes"


def test_agentshield_end_to_end_with_database_stores(
    db_session: Session,
) -> None:
    policy_provider = SqlAlchemyPolicyProvider(db_session)
    intent_provider = SqlAlchemyIntentProvider(db_session)
    txn_store = SqlAlchemyTransactionStore(db_session)
    audit_sink = SqlAlchemyAuditSink(db_session)
    payment_provider = MockPaymentProvider()

    policy_provider.set_policy(
        "customer_session",
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
            max_session_spend=10000,
        ),
    )
    intent_provider.set_intent(
        "customer_session",
        AuthorizedIntent(
            category="footwear",
            purpose="running shoes",
            max_amount=5000,
            currency="INR",
        ),
    )

    shield = AgentShield(
        policy_or_provider=policy_provider,
        payment_provider=payment_provider,
        transaction_store=txn_store,
        audit_sink=audit_sink,
        intent_provider=intent_provider,
    )

    # 1. Execute allowed tool request
    res1 = shield.execute_tool(
        session_id="customer_session",
        tool_name="create_order",
        arguments={"amount": 4200, "category": "footwear"},
    )
    assert res1.decision == "ALLOW"
    assert res1.transaction_status == TransactionStatus.SUCCEEDED
    assert shield.get_committed_spend("customer_session") == 4200

    # 2. Execute semantically invalid request (gift card) -> BLOCK
    res2 = shield.execute_tool(
        session_id="customer_session",
        tool_name="create_order",
        arguments={"amount": 4200, "category": "gift_card"},
    )
    assert res2.decision == "BLOCK"
    assert "INTENT_CATEGORY_MISMATCH" in res2.reasons
    assert shield.get_committed_spend("customer_session") == 4200

    # 3. Verify Database audit trail has both events recorded (newest first)
    audit_events = audit_sink.list_by_session("customer_session")
    assert len(audit_events) == 2
    assert audit_events[0].decision == "BLOCK"
    assert audit_events[1].decision == "ALLOW"
    assert audit_events[0].policy_violations[0].rule == "INTENT_CATEGORY_MISMATCH"


def test_durable_spend_across_independent_shield_instances(
    db_engine,
) -> None:
    """Proves that a newly instantiated AgentShield reading from DB sees prior spend and enforces limits."""
    SessionFactory = sessionmaker(
        autocommit=False, autoflush=False, bind=db_engine
    )

    # Connection 1: Create session with policy limit = 8000
    db1 = SessionFactory()
    policy_prov1 = SqlAlchemyPolicyProvider(db1)
    policy_prov1.set_policy(
        "shared_session",
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
            max_session_spend=8000,
        ),
    )
    shield1 = AgentShield(
        policy_or_provider=policy_prov1,
        payment_provider=MockPaymentProvider(),
        transaction_store=SqlAlchemyTransactionStore(db1),
        audit_sink=SqlAlchemyAuditSink(db1),
        intent_provider=SqlAlchemyIntentProvider(db1),
    )

    # Worker 1 executes ₹4,500 order
    res1 = shield1.execute_tool(
        session_id="shared_session",
        tool_name="create_order",
        arguments={"amount": 4500},
    )
    assert res1.decision == "ALLOW"
    assert shield1.get_committed_spend("shared_session") == 4500
    db1.close()

    # Worker 2 / Next Request: completely fresh DB session and AgentShield instance
    db2 = SessionFactory()
    shield2 = AgentShield(
        policy_or_provider=SqlAlchemyPolicyProvider(db2),
        payment_provider=MockPaymentProvider(),
        transaction_store=SqlAlchemyTransactionStore(db2),
        audit_sink=SqlAlchemyAuditSink(db2),
        intent_provider=SqlAlchemyIntentProvider(db2),
    )

    # Worker 2 immediately sees the persisted spend from DB
    assert shield2.get_committed_spend("shared_session") == 4500
    assert shield2.get_session_spend("shared_session") == 4500

    # Worker 2 executes ₹4,000 order -> Total spend would be ₹8,500 > ₹8,000 max -> MUST BLOCK
    res2 = shield2.execute_tool(
        session_id="shared_session",
        tool_name="create_order",
        arguments={"amount": 4000},
    )
    assert res2.decision == "BLOCK"
    assert "MAX_SESSION_SPEND" in res2.reasons
    assert shield2.get_committed_spend("shared_session") == 4500

    # Worker 2 executes ₹3,000 order -> Total spend is ₹7,500 <= ₹8,000 -> ALLOW
    res3 = shield2.execute_tool(
        session_id="shared_session",
        tool_name="create_order",
        arguments={"amount": 3000},
    )
    assert res3.decision == "ALLOW"
    assert shield2.get_committed_spend("shared_session") == 7500
    db2.close()
