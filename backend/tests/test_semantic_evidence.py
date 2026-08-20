from typing import Any

from app.agentshield.executor import AgentShield
from app.agentshield.intent import AuthorizedIntent, IntentValidationResult
from app.agentshield.intent_provider import InMemoryIntentProvider
from app.agentshield.policy_engine import Policy
from app.providers.llm.base import LLMProviderError
from app.providers.llm.mock import MockLLMProvider
from app.providers.payments.mock import MockPaymentProvider


class MismatchLLMProvider(MockLLMProvider):
    def compare_semantic_intent(
        self,
        intent: AuthorizedIntent,
        *,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> IntentValidationResult:
        return IntentValidationResult(
            intent_match=False,
            category_match=False,
            confidence=0.99,
            reasons=["INTENT_CATEGORY_MISMATCH"],
            explanation="The semantic evidence does not match the authorized category.",
        )


class FailingLLMProvider(MockLLMProvider):
    def compare_semantic_intent(
        self,
        intent: AuthorizedIntent,
        *,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> IntentValidationResult:
        raise LLMProviderError("NIM unavailable")


def _intent_provider() -> InMemoryIntentProvider:
    return InMemoryIntentProvider(
        intents={
            "session_123": AuthorizedIntent(
                category="footwear",
                purpose="running shoes",
                max_amount=5000,
                currency="INR",
                allowed_tools=frozenset({"create_order"}),
            )
        }
    )


def _policy() -> Policy:
    return Policy(
        allowed_tools=frozenset({"create_order"}),
        max_transaction_amount=5000,
        max_session_spend=10000,
    )


def test_semantic_mismatch_blocks_before_payment_provider() -> None:
    payment = MockPaymentProvider()
    shield = AgentShield(
        _policy(),
        payment_provider=payment,
        intent_provider=_intent_provider(),
        llm_provider=MismatchLLMProvider(),
    )

    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 4500, "category": "footwear"},
    )

    assert result.decision == "BLOCK"
    assert result.risk_level == "CRITICAL"
    assert result.semantic_validation is not None
    assert result.semantic_validation.intent_match is False
    assert payment.fetch_order(order_id="order_mock_000001").success is False
    event = shield.audit_sink.list_by_session("session_123")[0]
    assert event.semantic_validation is not None
    assert event.semantic_validation.intent_match is False


def test_semantic_provider_failure_fails_closed() -> None:
    payment = MockPaymentProvider()
    shield = AgentShield(
        _policy(),
        payment_provider=payment,
        intent_provider=_intent_provider(),
        llm_provider=FailingLLMProvider(),
    )

    result = shield.execute_tool(
        session_id="session_123",
        tool_name="create_order",
        arguments={"amount": 4500, "category": "footwear"},
    )

    assert result.decision == "BLOCK"
    assert result.reasons == ["SEMANTIC_VALIDATION_UNAVAILABLE"]
    assert result.error == "Semantic validation unavailable"
    assert payment.fetch_order(order_id="order_mock_000001").success is False
