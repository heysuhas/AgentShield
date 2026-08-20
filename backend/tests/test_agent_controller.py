from typing import Any

from app.agent.controller import AgentController
from app.agentshield.executor import AgentShield
from app.agentshield.intent import AuthorizedIntent
from app.agentshield.policy_engine import Policy
from app.providers.llm.base import LLMMessage, LLMResponse
from app.providers.payments.mock import MockPaymentProvider


class DemoLLM:
    def extract_intent(self, user_prompt: str) -> AuthorizedIntent:
        return AuthorizedIntent(
            category="footwear",
            purpose="running shoes",
            max_amount=5000,
            currency="INR",
            allowed_tools=frozenset({"create_order", "create_payout"}),
        )

    def chat_complete(
        self,
        messages: list[LLMMessage],
        *,
        response_format: dict[str, Any] | None = None,
        temperature: float = 0.0,
    ) -> LLMResponse:
        return LLMResponse(
            content=(
                '{"tool_name":"create_order","arguments":'
                '{"amount":4500,"currency":"INR","category":"footwear"}}'
            ),
            model="demo-model",
        )

    def compare_semantic_intent(self, intent, *, tool_name, arguments):
        from app.agentshield.intent import IntentValidationResult

        return IntentValidationResult(intent_match=True, confidence=0.99)


def test_agent_proposes_then_routes_only_through_agentshield() -> None:
    payment = MockPaymentProvider()
    shield = AgentShield(
        Policy(
            allowed_tools=frozenset({"create_order"}),
            max_transaction_amount=5000,
        ),
        payment_provider=payment,
        llm_provider=DemoLLM(),
    )

    intent, proposal, result = AgentController(DemoLLM()).run(
        shield=shield,
        session_id="agent_session",
        user_prompt="Buy running shoes under 5000",
    )

    assert intent.allowed_tools == frozenset({"create_order"})
    assert proposal["tool_name"] == "create_order"
    assert result.decision == "ALLOW"
    assert result.provider_result is not None
    assert result.provider_result.order is not None
    assert result.provider_result.order.id == "order_mock_000001"


def test_agent_proposal_cannot_expand_policy_permissions() -> None:
    class PayoutLLM(DemoLLM):
        def chat_complete(self, messages, *, response_format=None, temperature=0.0):
            return LLMResponse(
                content='{"tool_name":"create_payout","arguments":{"amount":100}}',
                model="demo-model",
            )

    payment = MockPaymentProvider()
    shield = AgentShield(
        Policy(allowed_tools=frozenset({"create_order"})),
        payment_provider=payment,
        llm_provider=PayoutLLM(),
    )

    _, proposal, result = AgentController(PayoutLLM()).run(
        shield=shield,
        session_id="agent_session",
        user_prompt="Make a payout",
    )

    assert proposal["tool_name"] == "create_payout"
    assert result.decision == "BLOCK"
    assert result.reasons == ["TOOL_NOT_ALLOWED"]
