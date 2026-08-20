"""Audit event models and in-memory audit sink."""

from datetime import datetime, timezone
from typing import Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from app.agentshield.policy_engine import PolicyViolation
from app.providers.payments.base import PaymentResult


class AuditEvent(BaseModel):
    """Immutable audit record for an authorized or blocked tool request."""

    event_id: str
    transaction_id: str | None = None
    session_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    decision: Literal["ALLOW", "BLOCK"]
    risk_score: float = Field(ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    policy_violations: list[PolicyViolation] = Field(default_factory=list)
    provider_name: str | None = None
    provider_result: PaymentResult | None = None
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


@runtime_checkable
class AuditSink(Protocol):
    """Protocol for recording and querying security audit events."""

    def record(self, event: AuditEvent) -> None:
        """Record an audit event."""
        ...

    def get(self, event_id: str) -> AuditEvent | None:
        """Retrieve an audit event by ID."""
        ...

    def list_by_session(self, session_id: str) -> list[AuditEvent]:
        """List all audit events for a session."""
        ...

    def list_all(self, limit: int = 100) -> list[AuditEvent]:
        """List all audit events up to a given limit."""
        ...


class InMemoryAuditSink:
    """In-memory append-only sink for security audit trails."""

    def __init__(self) -> None:
        self._events: list[AuditEvent] = []
        self._counter: int = 0

    def create_and_record(
        self,
        *,
        transaction_id: str | None = None,
        session_id: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        decision: Literal["ALLOW", "BLOCK"],
        risk_score: float,
        reasons: list[str] | None = None,
        policy_violations: list[PolicyViolation] | None = None,
        provider_name: str | None = None,
        provider_result: PaymentResult | None = None,
    ) -> AuditEvent:
        """Create, sequence, and store an audit event."""
        self._counter += 1
        event_id = f"evt_{self._counter:06d}"
        event = AuditEvent(
            event_id=event_id,
            transaction_id=transaction_id,
            session_id=session_id,
            tool_name=tool_name,
            arguments=arguments or {},
            decision=decision,
            risk_score=risk_score,
            reasons=reasons or [],
            policy_violations=policy_violations or [],
            provider_name=provider_name,
            provider_result=provider_result,
            timestamp=datetime.now(timezone.utc),
        )
        self._events.append(event)
        return event

    def record(self, event: AuditEvent) -> None:
        """Append an existing audit event."""
        self._events.append(event)

    def get(self, event_id: str) -> AuditEvent | None:
        for event in self._events:
            if event.event_id == event_id:
                return event
        return None

    def list_by_session(self, session_id: str) -> list[AuditEvent]:
        return [e for e in self._events if e.session_id == session_id]

    def list_all(self, limit: int = 100) -> list[AuditEvent]:
        return list(self._events[-limit:])

    def reset(self) -> None:
        """Clear all audit events and counter."""
        self._events.clear()
        self._counter = 0
