from concurrent.futures import ThreadPoolExecutor, as_completed
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy
from app.db.session import Base
from app.db.stores import (
    SqlAlchemyAuditSink,
    SqlAlchemyIntentProvider,
    SqlAlchemyPolicyProvider,
    SqlAlchemyTransactionStore,
)
from app.providers.payments.mock import MockPaymentProvider


@pytest.fixture
def db_engine(tmp_path):
    db_file = tmp_path / "test_atomic_spend.db"
    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"timeout": 30.0},
    )
    with engine.connect() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL;"))
        conn.commit()
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


def test_concurrent_spend_atomic_reservation(db_engine) -> None:
    """Proves that multiple concurrent worker threads cannot over-commit session budget."""
    SessionFactory = sessionmaker(
        autocommit=False, autoflush=False, bind=db_engine
    )

    # Setup session with ₹10,000 limit
    init_db = SessionFactory()
    policy_prov = SqlAlchemyPolicyProvider(init_db)
    policy_prov.set_policy(
        "concurrent_session",
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
            max_session_spend=10000,
        ),
    )
    init_db.close()

    def run_worker_request(amount: int) -> str:
        thread_db = SessionFactory()
        try:
            shield = AgentShield(
                policy_or_provider=SqlAlchemyPolicyProvider(thread_db),
                payment_provider=MockPaymentProvider(),
                transaction_store=SqlAlchemyTransactionStore(thread_db),
                audit_sink=SqlAlchemyAuditSink(thread_db),
                intent_provider=SqlAlchemyIntentProvider(thread_db),
            )
            result = shield.execute_tool(
                session_id="concurrent_session",
                tool_name="create_order",
                arguments={"amount": amount},
            )
            return result.decision
        finally:
            thread_db.close()

    # Launch 10 concurrent requests of ₹2,000 each (Total attempted = ₹20,000, Limit = ₹10,000)
    num_threads = 10
    amount_per_request = 2000
    results: list[str] = []

    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        futures = [
            executor.submit(run_worker_request, amount_per_request)
            for _ in range(num_threads)
        ]
        for f in as_completed(futures):
            results.append(f.result())

    allowed_count = results.count("ALLOW")
    blocked_count = results.count("BLOCK")

    assert allowed_count == 5
    assert blocked_count == 5

    # Verify database final spend
    final_db = SessionFactory()
    store = SqlAlchemyTransactionStore(final_db)
    committed = store.get_committed_spend("concurrent_session")
    reserved = store.get_reserved_spend("concurrent_session")
    assert committed == 10000
    assert reserved == 0
    final_db.close()
