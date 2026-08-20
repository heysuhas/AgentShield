"""The internal security boundary for agent tool requests."""

from typing import Literal

from pydantic import BaseModel, Field

from app.agentshield.policy_engine import (
    Policy,
    PolicyViolation,
    evaluate_policy,
)
from app.agentshield.policy_provider import InMemoryPolicyProvider, PolicyProvider
from app.providers.payments.base import PaymentProvider, PaymentResult


class ExecutionResult(BaseModel):
    """A policy decision returned before any provider can be called."""

    decision: Literal["ALLOW", "BLOCK"]
    session_id: str
    tool_name: str
    risk_score: float = Field(ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    policy_violations: list[PolicyViolation] = Field(default_factory=list)
    provider_result: PaymentResult | None = None


class AgentShield:
    """Evaluate tool requests against deterministic policy rules and dispatch to provider."""

    def __init__(
        self,
        policy_or_provider: Policy | PolicyProvider,
        payment_provider: PaymentProvider | None = None,
    ) -> None:
        if isinstance(policy_or_provider, Policy):
            self._provider: PolicyProvider = InMemoryPolicyProvider(
                default_policy=policy_or_provider
            )
        else:
            self._provider = policy_or_provider
        self._payment_provider = payment_provider
        self._session_spend: dict[str, int] = {}

    def get_session_spend(self, session_id: str) -> int:
        """Return the total approved transaction spend for a session."""
        return self._session_spend.get(session_id, 0)

    def reset_session_spend(self, session_id: str) -> None:
        """Reset the tracked spend for a session."""
        self._session_spend.pop(session_id, None)

    def execute_tool(
        self,
        *,
        session_id: str,
        tool_name: str,
        arguments: dict[str, object],
    ) -> ExecutionResult:
        """Return an authorization decision for an untrusted tool request."""

        policy = self._provider.get_policy(session_id)
        if policy is None:
            violation = PolicyViolation(
                rule="POLICY_NOT_FOUND",
                actual=session_id,
                limit="active policy",
            )
            return self._blocked_result(
                session_id=session_id,
                tool_name=tool_name,
                violations=[violation],
            )

        raw_amount = arguments.get("amount")
        if raw_amount is not None and (
            isinstance(raw_amount, bool)
            or not isinstance(raw_amount, int)
            or raw_amount < 0
        ):
            violation = PolicyViolation(
                rule="INVALID_AMOUNT",
                actual=str(raw_amount),
                limit="non-negative integer",
            )
            return self._blocked_result(
                session_id=session_id,
                tool_name=tool_name,
                violations=[violation],
            )

        current_spend = self.get_session_spend(session_id)

        policy_decision = evaluate_policy(
            policy,
            tool_name=tool_name,
            amount=raw_amount,
            current_session_spend=current_spend,
        )
        if not policy_decision.allowed:
            return self._blocked_result(
                session_id=session_id,
                tool_name=tool_name,
                violations=policy_decision.violations,
            )

        provider_result: PaymentResult | None = None
        if self._payment_provider is not None:
            if tool_name == "create_order":
                currency = str(arguments.get("currency", "INR"))
                receipt = arguments.get("receipt")
                notes = arguments.get("notes")
                provider_result = self._payment_provider.create_order(
                    amount=raw_amount if isinstance(raw_amount, int) else 0,
                    currency=currency,
                    receipt=str(receipt) if receipt is not None else None,
                    notes=dict(notes) if isinstance(notes, dict) else None,
                )
            elif tool_name == "fetch_order":
                order_id = str(arguments.get("order_id", ""))
                provider_result = self._payment_provider.fetch_order(
                    order_id=order_id
                )

        if raw_amount is not None:
            self._session_spend[session_id] = current_spend + raw_amount

        return ExecutionResult(
            decision="ALLOW",
            session_id=session_id,
            tool_name=tool_name,
            risk_score=0.0,
            provider_result=provider_result,
        )

    @staticmethod
    def _blocked_result(
        *,
        session_id: str,
        tool_name: str,
        violations: list[PolicyViolation],
    ) -> ExecutionResult:
        return ExecutionResult(
            decision="BLOCK",
            session_id=session_id,
            tool_name=tool_name,
            risk_score=1.0,
            reasons=[violation.rule for violation in violations],
            policy_violations=violations,
        )
