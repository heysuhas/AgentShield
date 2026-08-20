from app.agentshield.policy_engine import Policy, evaluate_policy


def test_allowed_tool_within_transaction_limit_is_allowed() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5_000,
    )

    decision = evaluate_policy(policy, tool_name="create_order", amount=4_999)

    assert decision.allowed is True
    assert decision.violations == []


def test_tool_not_in_policy_is_blocked() -> None:
    policy = Policy(allowed_tools=frozenset({"create_order"}))

    decision = evaluate_policy(policy, tool_name="create_payout", amount=100)

    assert decision.allowed is False
    assert decision.violations[0].rule == "TOOL_NOT_ALLOWED"


def test_amount_above_limit_is_blocked() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5_000,
    )

    decision = evaluate_policy(policy, tool_name="create_order", amount=5_001)

    assert decision.allowed is False
    assert decision.violations[0].rule == "MAX_TRANSACTION_AMOUNT"
    assert decision.violations[0].actual == 5_001
    assert decision.violations[0].limit == 5_000


def test_amount_at_limit_is_allowed() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5_000,
    )

    decision = evaluate_policy(policy, tool_name="create_order", amount=5_000)

    assert decision.allowed is True


def test_cumulative_amount_exceeding_session_limit_is_blocked() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5_000,
        max_session_spend=10_000,
    )

    # 4900 + 4800 = 9700 spent, trying to spend 4700 -> total 14400 > 10000
    decision = evaluate_policy(
        policy,
        tool_name="create_order",
        amount=4_700,
        current_session_spend=9_700,
    )

    assert decision.allowed is False
    assert decision.violations[0].rule == "MAX_SESSION_SPEND"
    assert decision.violations[0].actual == 14_400
    assert decision.violations[0].limit == 10_000


def test_cumulative_amount_within_session_limit_is_allowed() -> None:
    policy = Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5_000,
        max_session_spend=10_000,
    )

    # 4900 spent, trying to spend 4800 -> total 9700 <= 10000
    decision = evaluate_policy(
        policy,
        tool_name="create_order",
        amount=4_800,
        current_session_spend=4_900,
    )

    assert decision.allowed is True
    assert decision.violations == []
