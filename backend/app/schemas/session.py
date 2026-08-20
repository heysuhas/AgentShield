from typing import Any
from pydantic import BaseModel, Field


class PolicySchema(BaseModel):
    """Configuration for agent tool permissions and limits."""

    allowed_tools: list[str] = Field(default_factory=list)
    max_transaction_amount: int | None = Field(default=None, ge=0)
    max_session_spend: int | None = Field(default=None, ge=0)
    max_requests_per_window: int | None = Field(default=None, ge=1)
    window_seconds: int = Field(default=60, ge=1)
    max_spend_per_window: int | None = Field(default=None, ge=0)
    require_approval_above: int | None = Field(default=None, ge=0)
    require_human_approval: bool = False


class IntentSchema(BaseModel):
    """Structured authorized user intent specification."""

    category: str | None = None
    purpose: str | None = None
    recipient: str | None = None
    merchant: str | None = None
    max_amount: int | None = Field(default=None, ge=0)
    currency: str = "INR"
    allowed_tools: list[str] | None = None
    constraints: dict[str, Any] = Field(default_factory=dict)


class CreateSessionRequest(BaseModel):
    """Payload to create a new session with an optional initial policy and intent."""

    session_id: str
    policy: PolicySchema | None = None
    intent: IntentSchema | None = None


class SetSessionPolicyRequest(BaseModel):
    """Payload to register or update a session's policy."""

    policy: PolicySchema


class SetSessionIntentRequest(BaseModel):
    """Payload to register or update a session's authorized intent."""

    intent: IntentSchema


class SessionResponse(BaseModel):
    """Response containing session state, active policy, intent, and spend metrics."""

    session_id: str
    status: str = "ACTIVE"
    policy: PolicySchema | None = None
    intent: IntentSchema | None = None
    committed_spend: int = 0
    reserved_spend: int = 0
    total_active_spend: int = 0
