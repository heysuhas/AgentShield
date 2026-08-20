"""API contracts for the agent demonstration loop."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.agentshield.intent import AuthorizedIntent
from app.schemas.tool_execution import ExecuteToolResponse


class AgentRunRequest(BaseModel):
    """A user instruction submitted to the autonomous agent."""

    session_id: str
    user_prompt: str = Field(min_length=1, max_length=8_000)


class AgentToolProposal(BaseModel):
    """The model's untrusted structured tool request."""

    tool_name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class AgentRunResponse(BaseModel):
    """Complete, judge-readable result of one agent security evaluation."""

    llm_provider: str
    user_prompt: str
    authorized_intent: AuthorizedIntent
    proposed_tool_call: AgentToolProposal
    decision: Literal["ALLOW", "REVIEW", "BLOCK"]
    execution: ExecuteToolResponse
