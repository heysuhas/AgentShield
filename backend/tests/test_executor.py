import pytest

from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy
from app.agentshield.transaction import TransactionStatus
from app.providers.payments.base import PaymentNetworkError
from app.providers.payments.mock import MockPaymentProvider


@pytest.fixture
def shield():
    return AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5_000,
        )
    )


def test_executor_allows_request_without_executing_a_provider(shield) -> None:
    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 4_999, "category": "footwear"},
    )

    assert result.decision == "ALLOW"
    assert result.session_id == "session_123"
    assert result.tool_name == "create_order"
    assert result.reasons == []
    assert result.policy_violations == []


def test_executor_blocks_disallowed_tool(shield) -> None:
    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_payout",
        arguments={"amount": 100},
    )

    assert result.decision == "BLOCK"
    assert result.reasons == ["TOOL_NOT_ALLOWED"]


def test_executor_blocks_invalid_amount_before_policy_evaluation(shield) -> None:
    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": "4999"},
    )

    assert result.decision == "BLOCK"
    assert result.reasons == ["INVALID_AMOUNT"]
    assert result.policy_violations[0].actual == "4999"


def test_executor_blocks_amount_above_policy_limit(shield) -> None:
    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 5_001},
    )

    assert result.decision == "BLOCK"
    assert result.reasons == ["MAX_TRANSACTION_AMOUNT"]


def test_executor_blocks_when_no_policy_found_for_session() -> None:
    from app.agentshield.policy_provider import InMemoryPolicyProvider

    empty_provider = InMemoryPolicyProvider()
    shield = AgentShield(empty_provider)

    result = shield.execute_tool(
        session_id="unregistered_session",
        tool_name="create_order",
        arguments={"amount": 100},
    )

    assert result.decision == "BLOCK"
    assert result.reasons == ["POLICY_NOT_FOUND"]
    assert result.policy_violations[0].rule == "POLICY_NOT_FOUND"
    assert result.policy_violations[0].actual == "unregistered_session"


def test_executor_uses_session_specific_policy() -> None:
    from app.agentshield.policy_provider import InMemoryPolicyProvider

    provider = InMemoryPolicyProvider(
        default_policy=Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
        ),
        policies={
            "vip_session": Policy(
                allowed_tools=frozenset({"create_order", "create_payout"}),
                max_transaction_amount=50000,
            )
        },
    )
    shield = AgentShield(provider)

    vip_result = shield.execute_tool(
        session_id="vip_session",
        tool_name="create_payout",
        arguments={"amount": 10000},
    )
    assert vip_result.decision == "ALLOW"

    default_result = shield.execute_tool(
        session_id="default_session",
        tool_name="create_payout",
        arguments={"amount": 1000},
    )
    assert default_result.decision == "BLOCK"
    assert default_result.reasons == ["TOOL_NOT_ALLOWED"]


def test_executor_tracks_and_enforces_aggregate_session_spending() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5000,
        max_session_spend=10000,
    )
    shield = AgentShield(policy)

    # 1. First transaction: ₹4,900 -> ALLOW
    r1 = shield.execute_tool(
        session_id="s1",
        tool_name="create_order",
        arguments={"amount": 4900},
    )
    assert r1.decision == "ALLOW"
    assert shield.get_session_spend("s1") == 4900

    # 2. Second transaction: ₹4,800 -> ALLOW (total = 9700)
    r2 = shield.execute_tool(
        session_id="s1",
        tool_name="create_order",
        arguments={"amount": 4800},
    )
    assert r2.decision == "ALLOW"
    assert shield.get_session_spend("s1") == 9700

    # 3. Third transaction: ₹4,700 -> BLOCK (9700 + 4700 = 14400 > 10000)
    r3 = shield.execute_tool(
        session_id="s1",
        tool_name="create_order",
        arguments={"amount": 4700},
    )
    assert r3.decision == "BLOCK"
    assert r3.reasons == ["MAX_SESSION_SPEND"]
    assert r3.policy_violations[0].actual == 14400
    assert r3.policy_violations[0].limit == 10000
    # Ensure blocked transaction did not increase spend
    assert shield.get_session_spend("s1") == 9700

    # 4. Small transaction within remaining budget: ₹300 -> ALLOW (total = 10000)
    r4 = shield.execute_tool(
        session_id="s1",
        tool_name="create_order",
        arguments={"amount": 300},
    )
    assert r4.decision == "ALLOW"
    assert shield.get_session_spend("s1") == 10000

    # 5. Any further spend -> BLOCK
    r5 = shield.execute_tool(
        session_id="s1",
        tool_name="create_order",
        arguments={"amount": 1},
    )
    assert r5.decision == "BLOCK"
    assert r5.reasons == ["MAX_SESSION_SPEND"]


def test_executor_blocks_policy_allowed_tool_unsupported_by_provider() -> None:
    provider = MockPaymentProvider()
    shield = AgentShield(
        Policy(allowed_tools=frozenset({"refund_payment"})),
        payment_provider=provider,
    )

    result = shield.execute_tool(
        session_id="s1",
        tool_name="refund_payment",
        arguments={"amount": 100},
    )

    assert result.decision == "BLOCK"
    assert result.reasons == ["PROVIDER_TOOL_UNSUPPORTED"]
    assert result.provider_result is None
    assert provider.fetch_order(order_id="order_mock_000001").success is False


def test_executor_releases_reservation_when_provider_raises() -> None:
    class RaisingProvider(MockPaymentProvider):
        def create_order(self, **kwargs):
            raise PaymentNetworkError("network unavailable")

    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_session_spend=1_000,
        ),
        payment_provider=RaisingProvider(),
    )

    result = shield.execute_tool(
        session_id="s1",
        tool_name="create_order",
        arguments={"amount": 400},
    )

    assert result.decision == "ALLOW"
    assert result.transaction_status == TransactionStatus.FAILED
    assert result.provider_result is not None
    assert result.provider_result.success is False
    assert result.provider_result.error == "Payment provider operation failed"
    assert shield.get_reserved_spend("s1") == 0
    assert shield.get_committed_spend("s1") == 0


def test_executor_invokes_payment_provider_on_allowed_action() -> None:
    from app.providers.payments.mock import MockPaymentProvider

    mock_payment = MockPaymentProvider()
    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order", "fetch_order"}),
            max_transaction_amount=5000,
        ),
        payment_provider=mock_payment,
    )

    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 4500, "category": "electronics", "receipt": "rec_001"},
    )

    assert result.decision == "ALLOW"
    assert result.provider_result is not None
    assert result.provider_result.success is True
    assert result.provider_result.order is not None
    assert result.provider_result.order.id == "order_mock_000001"
    assert result.provider_result.order.amount == 4500
    assert result.provider_result.order.receipt == "rec_001"
    assert len(mock_payment._orders) == 1


def test_executor_never_invokes_payment_provider_on_blocked_action() -> None:
    from app.providers.payments.mock import MockPaymentProvider

    mock_payment = MockPaymentProvider()
    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
        ),
        payment_provider=mock_payment,
    )

    # 1. Disallowed tool -> BLOCK
    r1 = shield.execute_tool(
        session_id="session_123",
        tool_name="create_payout",
        arguments={"amount": 100},
    )
    assert r1.decision == "BLOCK"
    assert r1.provider_result is None
    assert len(mock_payment._orders) == 0

    # 2. Exceeding max transaction amount -> BLOCK
    r2 = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 6000},
    )
    assert r2.decision == "BLOCK"
    assert r2.provider_result is None
    assert len(mock_payment._orders) == 0

    # 3. Invalid amount -> BLOCK
    r3 = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": "invalid"},
    )
    assert r3.decision == "BLOCK"
    assert r3.provider_result is None
    assert len(mock_payment._orders) == 0


def test_executor_releases_reserved_spend_on_provider_failure() -> None:
    from app.agentshield.transaction import TransactionStatus
    from app.providers.payments.mock import MockPaymentProvider

    mock_payment = MockPaymentProvider()
    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
            max_session_spend=5000,
        ),
        payment_provider=mock_payment,
    )

    # 1. Simulate provider failure
    mock_payment.simulate_failure(error="Razorpay service unavailable")

    failed_result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 4500},
    )

    assert failed_result.decision == "ALLOW"
    assert failed_result.transaction_status == TransactionStatus.FAILED
    assert failed_result.provider_result is not None
    assert failed_result.provider_result.success is False
    assert failed_result.provider_result.error == "Razorpay service unavailable"

    # CRITICAL: Verify reserved spend was released and committed spend remains 0
    assert shield.get_committed_spend("session_123") == 0
    assert shield.get_reserved_spend("session_123") == 0
    assert shield.get_session_spend("session_123") == 0

    # 2. Recover provider - session should still have the full ₹5,000 budget!
    mock_payment.simulate_success()

    retry_result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 4500},
    )

    assert retry_result.decision == "ALLOW"
    assert retry_result.transaction_status == TransactionStatus.SUCCEEDED
    assert retry_result.provider_result is not None
    assert retry_result.provider_result.success is True
    assert shield.get_committed_spend("session_123") == 4500
    assert shield.get_session_spend("session_123") == 4500


def test_executor_enforces_intent_validation_and_blocks_semantic_deviation() -> None:
    """Canonical test: Policy allows tool and amount, but intent category is invalid."""
    from app.agentshield.intent import AuthorizedIntent
    from app.agentshield.intent_provider import InMemoryIntentProvider

    mock_payment = MockPaymentProvider()
    intent_provider = InMemoryIntentProvider(
        intents={
            "session_shoes": AuthorizedIntent(
                category="footwear",
                purpose="running shoes",
                max_amount=5000,
                currency="INR",
            )
        }
    )

    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
            max_session_spend=10000,
        ),
        payment_provider=mock_payment,
        intent_provider=intent_provider,
    )

    # 1. Attacker or misguided agent attempts to buy a gift card for ₹4,999
    # Policy permits create_order and ₹4,999 <= ₹5,000, but intent demands 'footwear'
    result = shield.execute_tool(
        session_id="session_shoes",
        tool_name="create_order",
        arguments={
            "amount": 4999,
            "currency": "INR",
            "category": "gift_card",
        },
    )

    assert result.decision == "BLOCK"
    assert result.risk_score >= 0.95
    assert "INTENT_CATEGORY_MISMATCH" in result.reasons
    assert result.intent_validation is not None
    assert result.intent_validation.intent_match is False
    assert result.intent_validation.category_match is False
    assert result.provider_result is None
    assert len(mock_payment._orders) == 0
    assert shield.get_session_spend("session_shoes") == 0


def test_executor_allows_transaction_when_intent_matches() -> None:
    from app.agentshield.intent import AuthorizedIntent
    from app.agentshield.intent_provider import InMemoryIntentProvider

    mock_payment = MockPaymentProvider()
    intent_provider = InMemoryIntentProvider(
        intents={
            "session_shoes": AuthorizedIntent(
                category="footwear",
                purpose="running shoes",
                max_amount=5000,
                currency="INR",
            )
        }
    )

    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
        ),
        payment_provider=mock_payment,
        intent_provider=intent_provider,
    )

    result = shield.execute_tool(
        session_id="session_shoes",
        tool_name="create_order",
        arguments={
            "amount": 4500,
            "currency": "INR",
            "category": "footwear",
        },
    )

    assert result.decision == "ALLOW"
    assert result.risk_score == 0.0
    assert result.intent_validation is not None
    assert result.intent_validation.intent_match is True
    assert result.provider_result is not None
    assert result.provider_result.success is True
    assert len(mock_payment._orders) == 1
