"""Schemas for querying and displaying security audit events."""

from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field

from app.agentshield.intent import IntentValidationResult
from app.agentshield.policy_engine import PolicyViolation
from app.providers.payments.base import PaymentResult


class AuditEventResponse(BaseModel):
    """Structured security audit event response."""

    event_id: str
    transaction_id: str | None = None
    transaction_status: str | None = None
    session_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    decision: Literal["ALLOW", "BLOCK"]
    risk_score: float
    risk_level: str
    reasons: list[str] = Field(default_factory=list)
    policy_violations: list[PolicyViolation] = Field(default_factory=list)
    semantic_validation: IntentValidationResult | None = None
    provider_name: str | None = None
    provider_result: PaymentResult | None = None
    timestamp: datetime


class PaginatedAuditResponse(BaseModel):
    """Paginated list of audit events."""

    total: int
    limit: int
    offset: int
    items: list[AuditEventResponse]
