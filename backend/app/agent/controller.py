"""Safe agent-to-AgentShield controller for demo and API integrations."""

import json
import re
from typing import Any

from app.agentshield.executor import AgentShield, ExecutionResult
from app.agentshield.intent import AuthorizedIntent

from app.providers.llm.base import LLMMessage, LLMProvider, LLMProviderError


class AgentControllerError(Exception):
    """Raised when the model cannot produce a valid structured tool request."""


def _parse_json_object(content: str) -> dict[str, Any]:
    """Parse one JSON object from a model response without executing model text."""
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    candidate = match.group(1) if match else content.strip()
    if not match:
        bare_match = re.search(r"(\{.*\})", candidate, re.DOTALL)
        candidate = bare_match.group(1) if bare_match else candidate
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise AgentControllerError("Agent returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise AgentControllerError("Agent response must be a JSON object")
    return parsed


def _build_proposal_prompt(user_prompt: str, intent: AuthorizedIntent) -> list[LLMMessage]:
    """Build a bounded tool-proposal prompt without hardcoded category bias."""
    return [
        LLMMessage(
            role="system",
            content=(
                "You are an autonomous payment agent. Given a user instruction, generate the exact tool call and its arguments. "
                "Output ONLY a JSON object with keys 'tool_name' and 'arguments'. "
                "Allowed tool_name values: 'create_order', 'fetch_order'. "
                "For create_order, include arguments: 'amount' (integer in INR), 'currency' ('INR'), 'category' (string), 'purpose' (string). "
                "Extract the category, purpose, and amount directly from the user prompt."
            ),
        ),
        LLMMessage(
            role="user",
            content=(
                f"Authorized intent context: {intent.model_dump_json()}\n"
                f"<user_prompt>\n{user_prompt}\n</user_prompt>\n"
                "Return the proposed tool request JSON:"
            ),
        ),
    ]


class AgentController:
    """Ask an LLM for a request, then route it through AgentShield exactly once."""

    def __init__(self, llm_provider: LLMProvider) -> None:
        self._llm_provider = llm_provider

    def run(
        self,
        *,
        shield: AgentShield,
        session_id: str,
        user_prompt: str,
    ) -> tuple[AuthorizedIntent, dict[str, Any], ExecutionResult]:
        """Extract intent, propose a tool request, and enforce it through the shield."""
        try:
            extracted_intent = self._llm_provider.extract_intent(user_prompt)
            response = self._llm_provider.chat_complete(
                _build_proposal_prompt(user_prompt, extracted_intent),
                temperature=0.0,
            )
        except LLMProviderError as exc:
            raise AgentControllerError(f"NVIDIA NIM agent call failed: {exc}") from exc

        policy = shield.policy_provider.get_policy(session_id)
        if policy is None:
            from app.agentshield.policy_engine import Policy
            policy = Policy(
                allowed_tools=frozenset({"create_order", "fetch_order"}),
                max_transaction_amount=5000,
                max_session_spend=10000,
                max_requests_per_window=4,
                window_seconds=60,
                require_approval_above=3000,
            )
            if hasattr(shield.policy_provider, "set_policy"):
                shield.policy_provider.set_policy(session_id, policy)

        extracted_tools = frozenset(extracted_intent.allowed_tools or frozenset())
        allowed_tools = extracted_tools & policy.allowed_tools
        authorized_tools = allowed_tools or None
        intent = extracted_intent.model_copy(update={"allowed_tools": authorized_tools})
        # Set dynamic intent from the user's prompt
        shield.intent_provider.set_intent(session_id, intent)

        parsed = _parse_json_object(response.content)
        tool_name = parsed.get("tool_name")
        arguments = parsed.get("arguments")
        if not isinstance(tool_name, str) or not isinstance(arguments, dict):
            raise AgentControllerError("Agent tool request has an invalid shape")

        result = shield.execute_tool(
            session_id=session_id,
            tool_name=tool_name,
            arguments=arguments,
        )
        return intent, {"tool_name": tool_name, "arguments": arguments}, result
