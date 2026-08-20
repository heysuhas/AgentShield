"""Pydantic schemas for session lifecycle management."""

from pydantic import BaseModel, Field


class PolicySchema(BaseModel):
    """Configuration for agent tool permissions and limits."""

    allowed_tools: list[str] = Field(default_factory=list)
    max_transaction_amount: int | None = Field(default=None, ge=0)
    max_session_spend: int | None = Field(default=None, ge=0)


class CreateSessionRequest(BaseModel):
    """Payload to create a new session with an optional initial policy."""

    session_id: str
    policy: PolicySchema | None = None


class SetSessionPolicyRequest(BaseModel):
    """Payload to register or update a session's policy."""

    policy: PolicySchema


class SessionResponse(BaseModel):
    """Response containing session state, active policy, and spend metrics."""

    session_id: str
    status: str = "ACTIVE"
    policy: PolicySchema | None = None
    committed_spend: int = 0
    reserved_spend: int = 0
    total_active_spend: int = 0
