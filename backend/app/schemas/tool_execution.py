"""Schemas for tool execution requests and responses."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.agentshield.intent import IntentValidationResult
from app.agentshield.policy_engine import PolicyViolation
from app.agentshield.transaction import TransactionStatus
from app.providers.payments.base import PaymentResult


class ExecuteToolRequest(BaseModel):
    """Payload to request execution of an agent tool."""

    session_id: str
    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ExecuteToolResponse(BaseModel):
    """Response returned by AgentShield for a tool execution request."""

    decision: Literal["ALLOW", "BLOCK"]
    session_id: str
    tool_name: str
    risk_score: float = Field(ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    policy_violations: list[PolicyViolation] = Field(default_factory=list)
    intent_validation: IntentValidationResult | None = None
    provider_result: PaymentResult | None = None
    transaction_id: str | None = None
    transaction_status: TransactionStatus | None = None
