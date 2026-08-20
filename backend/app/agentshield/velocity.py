"""Velocity and burst limit detection engine."""

from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field

from app.agentshield.policy_engine import Policy, PolicyViolation
from app.agentshield.transaction import TransactionStatus, TransactionStore


class VelocityCheckResult(BaseModel):
    """Result of evaluating frequency and burst spending in a sliding window."""

    allowed: bool
    violations: list[PolicyViolation] = Field(default_factory=list)
    request_count: int = 0
    window_spend: int = 0
    window_seconds: int = 60


class VelocityEngine:
    """Evaluates request frequency and sliding-window spending velocity."""

    @staticmethod
    def check_velocity(
        *,
        session_id: str,
        policy: Policy,
        transaction_store: TransactionStore,
        incoming_amount: int | None = None,
        now: datetime | None = None,
    ) -> VelocityCheckResult:
        """Check if an incoming request exceeds session velocity or burst limits."""
        if (
            policy.max_requests_per_window is None
            and policy.max_spend_per_window is None
        ):
            return VelocityCheckResult(
                allowed=True,
                violations=[],
                request_count=0,
                window_spend=0,
                window_seconds=policy.window_seconds,
            )

        current_time = now or datetime.now(timezone.utc)
        cutoff = current_time - timedelta(seconds=policy.window_seconds)

        recent_txns = transaction_store.list_since(session_id, cutoff)

        active_statuses = {
            TransactionStatus.AUTHORIZED,
            TransactionStatus.SUCCEEDED,
            TransactionStatus.PENDING,
        }

        # Count active/authorized requests in the sliding window
        window_txns = [t for t in recent_txns if t.status in active_statuses]
        request_count = len(window_txns)
        window_spend = sum(t.amount or 0 for t in window_txns)

        violations: list[PolicyViolation] = []

        # 1. Request count check (including the current incoming request)
        if (
            policy.max_requests_per_window is not None
            and (request_count + 1) > policy.max_requests_per_window
        ):
            violations.append(
                PolicyViolation(
                    rule="VELOCITY_REQUEST_LIMIT_EXCEEDED",
                    actual=request_count + 1,
                    limit=policy.max_requests_per_window,
                )
            )

        # 2. Window spend check (including the current incoming amount)
        if (
            policy.max_spend_per_window is not None
            and incoming_amount is not None
            and (window_spend + incoming_amount) > policy.max_spend_per_window
        ):
            violations.append(
                PolicyViolation(
                    rule="VELOCITY_SPEND_LIMIT_EXCEEDED",
                    actual=window_spend + incoming_amount,
                    limit=policy.max_spend_per_window,
                )
            )

        return VelocityCheckResult(
            allowed=len(violations) == 0,
            violations=violations,
            request_count=request_count,
            window_spend=window_spend,
            window_seconds=policy.window_seconds,
        )
