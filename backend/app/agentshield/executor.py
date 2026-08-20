"""The internal security boundary for agent tool requests."""

from typing import Literal

from pydantic import BaseModel, Field

from app.agentshield.audit import AuditSink, InMemoryAuditSink
from app.agentshield.intent import AuthorizedIntent, IntentValidationResult
from app.agentshield.intent_provider import (
    InMemoryIntentProvider,
    IntentProvider,
)
from app.agentshield.intent_validator import (
    validate_intent_deterministically,
)
from app.agentshield.policy_engine import (
    Policy,
    PolicyViolation,
    evaluate_policy,
)
from app.agentshield.policy_provider import InMemoryPolicyProvider, PolicyProvider
from app.agentshield.risk_engine import RiskResult, evaluate_risk
from app.agentshield.transaction import (
    InMemoryTransactionStore,
    TransactionRecord,
    TransactionStatus,
    TransactionStore,
)
from app.agentshield.velocity import VelocityEngine
from app.providers.llm.base import LLMProvider, LLMProviderError
from app.providers.payments.base import (
    PaymentProvider,
    PaymentProviderError,
    PaymentResult,
)


_SUPPORTED_PROVIDER_TOOLS = frozenset({"create_order", "fetch_order"})


def _intent_violations(
    intent: AuthorizedIntent,
    validation: IntentValidationResult,
    *,
    tool_name: str,
    arguments: dict[str, object],
) -> list[PolicyViolation]:
    """Convert intent evidence into precise machine-readable violations."""

    evidence: dict[str, tuple[int | str, int | str | None]] = {
        "INTENT_TOOL_MISMATCH": (
            tool_name,
            ", ".join(sorted(intent.allowed_tools or frozenset())),
        ),
        "INTENT_CATEGORY_MISMATCH": (
            str(arguments.get("category") or "<missing>"),
            intent.category,
        ),
        "INTENT_PURPOSE_MISMATCH": (
            str(arguments.get("purpose") or "<missing>"),
            intent.purpose,
        ),
        "INTENT_RECIPIENT_MISMATCH": (
            str(arguments.get("recipient") or "<missing>"),
            intent.recipient,
        ),
        "INTENT_MERCHANT_MISMATCH": (
            str(arguments.get("merchant") or "<missing>"),
            intent.merchant,
        ),
        "INTENT_AMOUNT_EXCEEDED": (
            str(arguments.get("amount") or "<missing>"),
            intent.max_amount,
        ),
        "INTENT_CURRENCY_MISMATCH": (
            str(arguments.get("currency") or "<missing>"),
            intent.currency,
        ),
    }
    return [
        PolicyViolation(
            rule=reason,
            actual=evidence.get(reason, (reason, None))[0],
            limit=evidence.get(reason, (reason, None))[1],
        )
        for reason in validation.reasons
    ]


class ExecutionResult(BaseModel):
    """A policy decision returned before any provider can be called."""

    decision: Literal["ALLOW", "BLOCK"]
    session_id: str
    tool_name: str
    risk_score: float = Field(ge=0.0, le=1.0)
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "LOW"
    reasons: list[str] = Field(default_factory=list)
    policy_violations: list[PolicyViolation] = Field(default_factory=list)
    intent_validation: IntentValidationResult | None = None
    semantic_validation: IntentValidationResult | None = None
    provider_result: PaymentResult | None = None
    transaction_id: str | None = None
    transaction_status: TransactionStatus | None = None
    error: str | None = None


class AgentShield:
    """Evaluate tool requests against deterministic policy rules and dispatch to provider."""

    def __init__(
        self,
        policy_or_provider: Policy | PolicyProvider,
        payment_provider: PaymentProvider | None = None,
        transaction_store: TransactionStore | None = None,
        audit_sink: AuditSink | None = None,
        intent_provider: IntentProvider | None = None,
        llm_provider: LLMProvider | None = None,
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
        self._audit_sink: AuditSink = audit_sink or InMemoryAuditSink()
        self._intent_provider: IntentProvider = (
            intent_provider or InMemoryIntentProvider()
        )
        self._llm_provider = llm_provider

    @property
    def audit_sink(self) -> AuditSink:
        """Return the configured audit sink."""
        return self._audit_sink

    @property
    def policy_provider(self) -> PolicyProvider:
        """Return the configured policy provider."""
        return self._provider

    @property
    def transaction_store(self) -> TransactionStore:
        """Return the configured transaction store."""
        return self._transaction_store

    @property
    def intent_provider(self) -> IntentProvider:
        """Return the configured intent provider."""
        return self._intent_provider

    def get_committed_spend(self, session_id: str) -> int:
        """Return the settled/committed transaction spend for a session."""
        return self._transaction_store.get_committed_spend(session_id)

    def get_reserved_spend(self, session_id: str) -> int:
        """Return the currently reserved in-flight spend for a session."""
        return self._transaction_store.get_reserved_spend(session_id)

    def get_session_spend(self, session_id: str) -> int:
        """Return the total active spend (committed + reserved) for a session."""
        return self.get_committed_spend(session_id) + self.get_reserved_spend(
            session_id
        )

    def reset_session_spend(self, session_id: str) -> None:
        """Reset the tracked spend for a session by clearing/resetting store if supported."""
        if hasattr(self._transaction_store, "reset_session"):
            self._transaction_store.reset_session(session_id)

    def reset(self) -> None:
        """Reset all in-memory spend, transaction store, audit, and intent state."""
        if isinstance(self._transaction_store, InMemoryTransactionStore):
            self._transaction_store.reset()
        if isinstance(self._audit_sink, InMemoryAuditSink):
            self._audit_sink.reset()
        if isinstance(self._intent_provider, InMemoryIntentProvider):
            self._intent_provider.reset()

    def reconcile_stale_reservations(
        self, max_age_seconds: int = 300
    ) -> list[TransactionRecord]:
        """Reconcile stale reservations without losing provider state or spend accuracy."""
        stale = self._transaction_store.list_stale_reservations(
            max_age_seconds=max_age_seconds
        )
        reconciled: list[TransactionRecord] = []

        for txn in stale:
            pending = self._transaction_store.update_status(
                txn.transaction_id,
                status=TransactionStatus.PENDING,
                error="RECONCILIATION_IN_PROGRESS",
            )
            if pending is None:
                continue

            if txn.provider_order_id and self._payment_provider is not None:
                try:
                    fetch_res = self._payment_provider.fetch_order(
                        order_id=txn.provider_order_id
                    )
                except Exception:
                    fetch_res = None

                if fetch_res is not None and fetch_res.success and fetch_res.order:
                    provider_status = fetch_res.order.status.lower()
                    if provider_status == "paid":
                        settled = self._transaction_store.update_status(
                            txn.transaction_id,
                            status=TransactionStatus.SUCCEEDED,
                            provider_order_id=txn.provider_order_id,
                        )
                        if settled is not None:
                            self._audit_sink.create_and_record(
                                transaction_id=settled.transaction_id,
                                transaction_status=TransactionStatus.SUCCEEDED,
                                session_id=settled.session_id,
                                tool_name=settled.tool_name,
                                arguments=settled.arguments,
                                decision="ALLOW",
                                risk_score=0.1,
                                reasons=["RECONCILED_FROM_PROVIDER"],
                                provider_name=self._get_provider_name(),
                                provider_result=fetch_res,
                            )
                            reconciled.append(settled)
                        continue

                    # An existing but unpaid order remains retryable and must
                    # not consume committed spend yet.
                    self._audit_sink.create_and_record(
                        transaction_id=pending.transaction_id,
                        transaction_status=TransactionStatus.PENDING,
                        session_id=pending.session_id,
                        tool_name=pending.tool_name,
                        arguments=pending.arguments,
                        decision="BLOCK",
                        risk_score=0.5,
                        reasons=["PROVIDER_ORDER_PENDING"],
                        provider_name=self._get_provider_name(),
                        provider_result=fetch_res,
                    )
                    reconciled.append(pending)
                    continue

                # Provider lookup failed or returned no confirmed order. Keep
                # the transaction pending so a later reconciliation can retry.
                self._audit_sink.create_and_record(
                    transaction_id=pending.transaction_id,
                    transaction_status=TransactionStatus.PENDING,
                    session_id=pending.session_id,
                    tool_name=pending.tool_name,
                    arguments=pending.arguments,
                    decision="BLOCK",
                    risk_score=0.5,
                    reasons=["PROVIDER_LOOKUP_PENDING"],
                    provider_name=self._get_provider_name(),
                    provider_result=fetch_res,
                )
                reconciled.append(pending)
                continue

            cancelled = self._transaction_store.update_status(
                txn.transaction_id,
                status=TransactionStatus.CANCELLED,
                error="RESERVATION_EXPIRED",
            )
            if cancelled is not None:
                self._audit_sink.create_and_record(
                    transaction_id=cancelled.transaction_id,
                    transaction_status=TransactionStatus.CANCELLED,
                    session_id=cancelled.session_id,
                    tool_name=cancelled.tool_name,
                    arguments=cancelled.arguments,
                    decision="BLOCK",
                    risk_score=0.5,
                    reasons=["RESERVATION_EXPIRED"],
                )
                reconciled.append(cancelled)

        return reconciled

    def _get_provider_name(self) -> str | None:
        if self._payment_provider is not None:
            return self._payment_provider.__class__.__name__
        return None

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
        amount: int | None = (
            raw_amount
            if isinstance(raw_amount, int) and not isinstance(raw_amount, bool)
            else None
        )
        if (
            "amount" in arguments
            and (amount is None or amount <= 0)
        ) or (tool_name == "create_order" and "amount" not in arguments):
            violation = PolicyViolation(
                rule="INVALID_AMOUNT",
                actual=str(raw_amount),
                limit="positive integer",
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
            amount=amount,
            current_session_spend=active_spend,
        )
        if not policy_decision.allowed:
            return self._record_and_block(
                session_id=session_id,
                tool_name=tool_name,
                arguments=arguments,
                amount=amount,
                violations=policy_decision.violations,
            )

        # 1.5. Velocity and burst rate evaluation
        velocity_result = VelocityEngine.check_velocity(
            session_id=session_id,
            policy=policy,
            transaction_store=self._transaction_store,
            incoming_amount=amount,
        )
        if not velocity_result.allowed:
            return self._record_and_block(
                session_id=session_id,
                tool_name=tool_name,
                arguments=arguments,
                amount=amount,
                violations=velocity_result.violations,
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
                amount=amount,
                violations=[violation],
            )

        # 2. Intent validation check
        intent = self._intent_provider.get_intent(session_id)
        intent_validation: IntentValidationResult | None = None
        semantic_validation: IntentValidationResult | None = None
        if intent is not None:
            intent_validation = validate_intent_deterministically(
                intent,
                tool_name=tool_name,
                arguments=dict(arguments),
            )
            if not intent_validation.intent_match:
                violations = _intent_violations(
                    intent,
                    intent_validation,
                    tool_name=tool_name,
                    arguments=dict(arguments),
                )
                return self._record_and_block(
                    session_id=session_id,
                    tool_name=tool_name,
                    arguments=arguments,
                    amount=amount,
                    violations=violations,
                    intent_validation=intent_validation,
                )

            if self._llm_provider is not None:
                try:
                    semantic_validation = self._llm_provider.compare_semantic_intent(
                        intent,
                        tool_name=tool_name,
                        arguments=dict(arguments),
                    )
                except LLMProviderError as exc:
                    violation = PolicyViolation(
                        rule="SEMANTIC_VALIDATION_UNAVAILABLE",
                        actual=str(exc),
                        limit="valid semantic evidence",
                    )
                    return self._record_and_block(
                        session_id=session_id,
                        tool_name=tool_name,
                        arguments=arguments,
                        amount=amount,
                        violations=[violation],
                        intent_validation=intent_validation,
                        error="Semantic validation unavailable",
                    )
                except Exception:
                    violation = PolicyViolation(
                        rule="SEMANTIC_VALIDATION_UNAVAILABLE",
                        actual="LLM provider error",
                        limit="valid semantic evidence",
                    )
                    return self._record_and_block(
                        session_id=session_id,
                        tool_name=tool_name,
                        arguments=arguments,
                        amount=amount,
                        violations=[violation],
                        intent_validation=intent_validation,
                        error="Semantic validation unavailable",
                    )

                if not semantic_validation.intent_match:
                    violations = _intent_violations(
                        intent,
                        semantic_validation,
                        tool_name=tool_name,
                        arguments=dict(arguments),
                    )
                    return self._record_and_block(
                        session_id=session_id,
                        tool_name=tool_name,
                        arguments=arguments,
                        amount=amount,
                        violations=violations,
                        intent_validation=intent_validation,
                        semantic_validation=semantic_validation,
                    )

        # 1. Authorize and atomically reserve spend against session budget
        currency = str(arguments.get("currency", "INR"))
        txn, is_authorized = self._transaction_store.reserve_and_authorize(
            session_id=session_id,
            tool_name=tool_name,
            amount=amount,
            currency=currency,
            max_session_spend=policy.max_session_spend,
            arguments=arguments,
        )

        if not is_authorized:
            active_spend = self.get_session_spend(session_id)
            violation = PolicyViolation(
                rule="MAX_SESSION_SPEND",
                actual=active_spend + (amount or 0),
                limit=policy.max_session_spend,
            )
            risk_result = evaluate_risk(policy_violations=[violation])
            self._audit_sink.create_and_record(
                transaction_id=txn.transaction_id,
                transaction_status=TransactionStatus.BLOCKED,
                session_id=session_id,
                tool_name=tool_name,
                arguments=arguments,
                decision="BLOCK",
                risk_score=risk_result.risk_score,
                risk_level=risk_result.risk_level,
                reasons=risk_result.reasons,
                policy_violations=[violation],
            )
            return ExecutionResult(
                decision="BLOCK",
                session_id=session_id,
                tool_name=tool_name,
                risk_score=risk_result.risk_score,
                risk_level=risk_result.risk_level,
                reasons=risk_result.reasons,
                policy_violations=[violation],
                intent_validation=intent_validation,
                transaction_id=txn.transaction_id,
                transaction_status=TransactionStatus.BLOCKED,
            )

        provider_result: PaymentResult | None = None
        current_status = TransactionStatus.AUTHORIZED
        risk_result = evaluate_risk(
            intent_validation=intent_validation,
            semantic_validation=semantic_validation,
        )

        if self._payment_provider is not None:
            try:
                if tool_name == "create_order":
                    receipt = arguments.get("receipt") or txn.transaction_id
                    notes = arguments.get("notes")
                    provider_result = self._payment_provider.create_order(
                        amount=amount or 0,
                        currency=currency,
                        receipt=str(receipt)[:40],
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
                order_id = (
                    provider_result.order.id
                    if provider_result.order
                    else None
                )
                updated = self._transaction_store.update_status(
                    txn.transaction_id,
                    status=TransactionStatus.SUCCEEDED,
                    provider_order_id=order_id,
                )
                if updated is None:
                    # Transaction reservation timed out / was cancelled while provider was executing!
                    current_status = TransactionStatus.CANCELLED
                    return ExecutionResult(
                        decision="BLOCK",
                        session_id=session_id,
                        tool_name=tool_name,
                        risk_score=1.0,
                        reasons=["TRANSACTION_EXPIRED_DURING_PROVIDER_CALL"],
                        transaction_id=txn.transaction_id,
                        transaction_status=TransactionStatus.CANCELLED,
                        error="Transaction expired during provider execution",
                    )
                current_status = TransactionStatus.SUCCEEDED
            elif provider_result is not None and not provider_result.success:
                current_status = TransactionStatus.FAILED
                self._transaction_store.update_status(
                    txn.transaction_id,
                    status=TransactionStatus.FAILED,
                    error=provider_result.error,
                )
        else:
            # Without payment provider, commit immediately
            current_status = TransactionStatus.SUCCEEDED
            self._transaction_store.update_status(
                txn.transaction_id,
                status=TransactionStatus.SUCCEEDED,
            )

        self._audit_sink.create_and_record(
            transaction_id=txn.transaction_id,
            transaction_status=current_status,
            session_id=session_id,
            tool_name=tool_name,
            arguments=dict(arguments),
            decision="ALLOW",
            risk_score=risk_result.risk_score,
            risk_level=risk_result.risk_level,
            reasons=risk_result.reasons,
            policy_violations=[],
            semantic_validation=semantic_validation,
            provider_name=self._get_provider_name(),
            provider_result=provider_result,
        )

        return ExecutionResult(
            decision="ALLOW",
            session_id=session_id,
            tool_name=tool_name,
            risk_score=risk_result.risk_score,
            risk_level=risk_result.risk_level,
            reasons=risk_result.reasons,
            intent_validation=intent_validation,
            semantic_validation=semantic_validation,
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
        risk_score: float | None = None,
        intent_validation: IntentValidationResult | None = None,
        semantic_validation: IntentValidationResult | None = None,
        risk_result: RiskResult | None = None,
        error: str | None = None,
    ) -> ExecutionResult:
        reasons = [violation.rule for violation in violations]
        resolved_risk = risk_result or evaluate_risk(
            policy_violations=violations,
            intent_validation=intent_validation,
            semantic_validation=semantic_validation,
        )
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

        self._audit_sink.create_and_record(
            transaction_id=txn.transaction_id,
            transaction_status=TransactionStatus.BLOCKED,
            session_id=session_id,
            tool_name=tool_name,
            arguments=dict(arguments),
            decision="BLOCK",
            risk_score=resolved_risk.risk_score,
            risk_level=resolved_risk.risk_level,
            reasons=reasons,
            policy_violations=violations,
            semantic_validation=semantic_validation,
            provider_name=self._get_provider_name(),
            provider_result=None,
        )

        return ExecutionResult(
            decision="BLOCK",
            session_id=session_id,
            tool_name=tool_name,
            risk_score=resolved_risk.risk_score,
            risk_level=resolved_risk.risk_level,
            reasons=reasons,
            policy_violations=violations,
            intent_validation=intent_validation,
            semantic_validation=semantic_validation,
            error=error,
            transaction_id=txn.transaction_id,
            transaction_status=TransactionStatus.BLOCKED,
        )
