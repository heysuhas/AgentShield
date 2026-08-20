"""The internal security boundary for agent tool requests."""

from typing import Literal

from pydantic import BaseModel, Field

from app.agentshield.policy_engine import (
    Policy,
    PolicyViolation,
    evaluate_policy,
)
from app.agentshield.policy_provider import InMemoryPolicyProvider, PolicyProvider
from app.agentshield.transaction import (
    InMemoryTransactionStore,
    TransactionStatus,
    TransactionStore,
)
from app.providers.payments.base import (
    PaymentProvider,
    PaymentProviderError,
    PaymentResult,
)


_SUPPORTED_PROVIDER_TOOLS = frozenset({"create_order", "fetch_order"})


class ExecutionResult(BaseModel):
    """A policy decision returned before any provider can be called."""

    decision: Literal["ALLOW", "BLOCK"]
    session_id: str
    tool_name: str
    risk_score: float = Field(ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    policy_violations: list[PolicyViolation] = Field(default_factory=list)
    provider_result: PaymentResult | None = None
    transaction_id: str | None = None
    transaction_status: TransactionStatus | None = None


class AgentShield:
    """Evaluate tool requests against deterministic policy rules and dispatch to provider."""

    def __init__(
        self,
        policy_or_provider: Policy | PolicyProvider,
        payment_provider: PaymentProvider | None = None,
        transaction_store: TransactionStore | None = None,
    ) -> None:
        if isinstance(policy_or_provider, Policy):
            self._provider: PolicyProvider = InMemoryPolicyProvider(
                default_policy=policy_or_provider
            )
        else:
            self._provider = policy_or_provider
        self._payment_provider = payment_provider
        self._transaction_store: TransactionStore = (
            transaction_store or InMemoryTransactionStore()
        )
        self._committed_spend: dict[str, int] = {}
        self._reserved_spend: dict[str, int] = {}

    def get_committed_spend(self, session_id: str) -> int:
        """Return the settled/committed transaction spend for a session."""
        return self._committed_spend.get(session_id, 0)

    def get_reserved_spend(self, session_id: str) -> int:
        """Return the currently reserved in-flight spend for a session."""
        return self._reserved_spend.get(session_id, 0)

    def get_session_spend(self, session_id: str) -> int:
        """Return the total active spend (committed + reserved) for a session."""
        return self.get_committed_spend(session_id) + self.get_reserved_spend(
            session_id
        )

    def reset_session_spend(self, session_id: str) -> None:
        """Reset the tracked spend for a session."""
        self._committed_spend.pop(session_id, None)
        self._reserved_spend.pop(session_id, None)

    def reset(self) -> None:
        """Reset all in-memory spend and transaction store state."""
        self._committed_spend.clear()
        self._reserved_spend.clear()
        if isinstance(self._transaction_store, InMemoryTransactionStore):
            self._transaction_store.reset()

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
            return self._record_and_block(
                session_id=session_id,
                tool_name=tool_name,
                arguments=arguments,
                amount=None,
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
            return self._record_and_block(
                session_id=session_id,
                tool_name=tool_name,
                arguments=arguments,
                amount=None,
                violations=[violation],
            )

        active_spend = self.get_session_spend(session_id)

        policy_decision = evaluate_policy(
            policy,
            tool_name=tool_name,
            amount=raw_amount,
            current_session_spend=active_spend,
        )
        if not policy_decision.allowed:
            return self._record_and_block(
                session_id=session_id,
                tool_name=tool_name,
                arguments=arguments,
                amount=raw_amount,
                violations=policy_decision.violations,
            )

        if (
            self._payment_provider is not None
            and tool_name not in _SUPPORTED_PROVIDER_TOOLS
        ):
            violation = PolicyViolation(
                rule="PROVIDER_TOOL_UNSUPPORTED",
                actual=tool_name,
                limit=", ".join(sorted(_SUPPORTED_PROVIDER_TOOLS)),
            )
            return self._record_and_block(
                session_id=session_id,
                tool_name=tool_name,
                arguments=arguments,
                amount=raw_amount,
                violations=[violation],
            )

        # 1. Authorize and create transaction record in AUTHORIZED status
        currency = str(arguments.get("currency", "INR"))
        txn = self._transaction_store.create(
            session_id=session_id,
            tool_name=tool_name,
            amount=raw_amount,
            currency=currency,
            status=TransactionStatus.AUTHORIZED,
            decision="ALLOW",
            arguments=arguments,
        )

        # 2. Reserve amount against session budget
        if raw_amount is not None and raw_amount > 0:
            self._reserved_spend[session_id] = (
                self.get_reserved_spend(session_id) + raw_amount
            )

        provider_result: PaymentResult | None = None
        current_status = TransactionStatus.AUTHORIZED

        if self._payment_provider is not None:
            try:
                if tool_name == "create_order":
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
            except PaymentProviderError as exc:
                provider_result = PaymentResult(
                    success=False,
                    error="Payment provider operation failed",
                    raw_response={"error": str(exc)},
                )
            except Exception:
                # The financial boundary must fail closed for unexpected provider errors.
                provider_result = PaymentResult(
                    success=False,
                    error="Payment provider operation failed",
                    raw_response={"error": "PROVIDER_ERROR"},
                )

            if provider_result is not None and provider_result.success:
                current_status = TransactionStatus.SUCCEEDED
                order_id = (
                    provider_result.order.id
                    if provider_result.order
                    else None
                )
                self._transaction_store.update_status(
                    txn.transaction_id,
                    status=TransactionStatus.SUCCEEDED,
                    provider_order_id=order_id,
                )
                # Commit spend and release reservation
                if raw_amount is not None and raw_amount > 0:
                    self._committed_spend[session_id] = (
                        self.get_committed_spend(session_id) + raw_amount
                    )
                    self._reserved_spend[session_id] = max(
                        0, self.get_reserved_spend(session_id) - raw_amount
                    )
            elif provider_result is not None and not provider_result.success:
                current_status = TransactionStatus.FAILED
                self._transaction_store.update_status(
                    txn.transaction_id,
                    status=TransactionStatus.FAILED,
                    error=provider_result.error,
                )
                # Release reserved spend so failed transaction does not consume budget
                if raw_amount is not None and raw_amount > 0:
                    self._reserved_spend[session_id] = max(
                        0, self.get_reserved_spend(session_id) - raw_amount
                    )
        else:
            # Without payment provider, commit immediately
            current_status = TransactionStatus.SUCCEEDED
            self._transaction_store.update_status(
                txn.transaction_id,
                status=TransactionStatus.SUCCEEDED,
            )
            if raw_amount is not None and raw_amount > 0:
                self._committed_spend[session_id] = (
                    self.get_committed_spend(session_id) + raw_amount
                )
                self._reserved_spend[session_id] = max(
                    0, self.get_reserved_spend(session_id) - raw_amount
                )

        return ExecutionResult(
            decision="ALLOW",
            session_id=session_id,
            tool_name=tool_name,
            risk_score=0.0,
            provider_result=provider_result,
            transaction_id=txn.transaction_id,
            transaction_status=current_status,
        )

    def _record_and_block(
        self,
        *,
        session_id: str,
        tool_name: str,
        arguments: dict[str, object],
        amount: int | None,
        violations: list[PolicyViolation],
    ) -> ExecutionResult:
        reasons = [violation.rule for violation in violations]
        txn = self._transaction_store.create(
            session_id=session_id,
            tool_name=tool_name,
            amount=amount,
            currency=str(arguments.get("currency", "INR")),
            status=TransactionStatus.BLOCKED,
            decision="BLOCK",
            reasons=reasons,
            arguments=arguments,
        )
        return ExecutionResult(
            decision="BLOCK",
            session_id=session_id,
            tool_name=tool_name,
            risk_score=1.0,
            reasons=reasons,
            policy_violations=violations,
            transaction_id=txn.transaction_id,
            transaction_status=TransactionStatus.BLOCKED,
        )
