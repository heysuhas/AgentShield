from app.agentshield.audit import AuditEvent, AuditSink, InMemoryAuditSink
from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy, PolicyViolation
from app.providers.payments.mock import MockPaymentProvider


def test_in_memory_audit_sink_implements_protocol() -> None:
    sink = InMemoryAuditSink()
    assert isinstance(sink, AuditSink)


def test_in_memory_audit_sink_recording_and_querying() -> None:
    sink = InMemoryAuditSink()

    event = sink.create_and_record(
        transaction_id="txn_000001",
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 4500},
        decision="ALLOW",
        risk_score=0.0,
        provider_name="MockPaymentProvider",
    )

    assert event.event_id == "evt_000001"
    assert event.transaction_id == "txn_000001"
    assert event.session_id == "session_123"
    assert event.decision == "ALLOW"
    assert event.risk_score == 0.0

    # Get by ID
    retrieved = sink.get("evt_000001")
    assert retrieved is not None
    assert retrieved.event_id == "evt_000001"

    # List by session
    session_events = sink.list_by_session("session_123")
    assert len(session_events) == 1
    assert session_events[0].event_id == "evt_000001"

    # List all
    assert len(sink.list_all()) == 1

    # Reset
    sink.reset()
    assert len(sink.list_all()) == 0
    assert sink.get("evt_000001") is None


def test_executor_records_audit_event_on_allow() -> None:
    mock_payment = MockPaymentProvider()
    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
        ),
        payment_provider=mock_payment,
    )

    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 4000, "category": "clothing"},
    )

    assert result.decision == "ALLOW"
    events = shield.audit_sink.list_by_session("session_123")
    assert len(events) == 1

    event = events[0]
    assert event.event_id == "evt_000001"
    assert event.transaction_id == result.transaction_id
    assert event.session_id == "session_123"
    assert event.tool_name == "create_order"
    assert event.decision == "ALLOW"
    assert event.risk_score == 0.0
    assert event.provider_name == "MockPaymentProvider"
    assert event.provider_result is not None
    assert event.provider_result.success is True
    assert event.provider_result.order is not None
    assert event.provider_result.order.id == "order_mock_000001"


def test_executor_records_audit_event_on_block() -> None:
    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
        )
    )

    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_payout",
        arguments={"amount": 100},
    )

    assert result.decision == "BLOCK"
    events = shield.audit_sink.list_by_session("session_123")
    assert len(events) == 1

    event = events[0]
    assert event.event_id == "evt_000001"
    assert event.transaction_id == result.transaction_id
    assert event.session_id == "session_123"
    assert event.tool_name == "create_payout"
    assert event.decision == "BLOCK"
    assert event.risk_score == 1.0
    assert event.reasons == ["TOOL_NOT_ALLOWED"]
    assert len(event.policy_violations) == 1
    assert event.policy_violations[0].rule == "TOOL_NOT_ALLOWED"
    assert event.provider_result is None
