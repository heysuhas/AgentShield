from app.agentshield.transaction import (
    InMemoryTransactionStore,
    TransactionRecord,
    TransactionStatus,
    TransactionStore,
)


def test_transaction_store_conforms_to_protocol() -> None:
    store = InMemoryTransactionStore()
    assert isinstance(store, TransactionStore)


def test_transaction_store_crud_lifecycle() -> None:
    store = InMemoryTransactionStore()

    txn = store.create(
        session_id="session_123",
        tool_name="create_order",
        amount=4500,
        currency="INR",
        status=TransactionStatus.AUTHORIZED,
        decision="ALLOW",
        arguments={"amount": 4500, "category": "electronics"},
    )

    assert txn.transaction_id == "txn_000001"
    assert txn.session_id == "session_123"
    assert txn.tool_name == "create_order"
    assert txn.amount == 4500
    assert txn.status == TransactionStatus.AUTHORIZED
    assert txn.decision == "ALLOW"

    # Get by ID
    retrieved = store.get("txn_000001")
    assert retrieved is not None
    assert retrieved.transaction_id == "txn_000001"

    # Update to SUCCEEDED with provider order ID
    updated = store.update_status(
        "txn_000001",
        status=TransactionStatus.SUCCEEDED,
        provider_order_id="order_mock_000001",
    )
    assert updated is not None
    assert updated.status == TransactionStatus.SUCCEEDED
    assert updated.provider_order_id == "order_mock_000001"

    # List by session
    session_txns = store.list_by_session("session_123")
    assert len(session_txns) == 1
    assert session_txns[0].transaction_id == "txn_000001"

    # Non-existent ID returns None
    assert store.get("txn_999999") is None
    assert (
        store.update_status("txn_999999", status=TransactionStatus.FAILED)
        is None
    )


def test_transaction_store_reset() -> None:
    store = InMemoryTransactionStore()
    store.create(
        session_id="s1",
        tool_name="create_order",
        amount=100,
        currency="INR",
        status=TransactionStatus.BLOCKED,
        decision="BLOCK",
    )
    assert len(store.list_by_session("s1")) == 1

    store.reset()
    assert len(store.list_by_session("s1")) == 0
    t2 = store.create(
        session_id="s1",
        tool_name="create_order",
        amount=200,
        currency="INR",
        status=TransactionStatus.AUTHORIZED,
        decision="ALLOW",
    )
    assert t2.transaction_id == "txn_000001"
