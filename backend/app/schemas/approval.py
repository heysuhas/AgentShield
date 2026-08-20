"""Schemas for human approval workflow requests and responses."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field

from app.schemas.tool_execution import ExecuteToolResponse


class ApprovalResponse(BaseModel):
    """Structured response representing a pending or resolved human review request."""

    approval_id: str
    transaction_id: str
    session_id: str
    status: str
    tool_name: str
    amount: int | None = None
    currency: str = "INR"
    arguments: dict[str, Any] = Field(default_factory=dict)
    risk_score: float
    risk_level: str
    reasons: list[str] = Field(default_factory=list)
    reviewed_by: str | None = None
    review_notes: str | None = None
    created_at: datetime
    updated_at: datetime


class PaginatedApprovalResponse(BaseModel):
    """Paginated list of approval records."""

    total: int
    limit: int
    offset: int
    items: list[ApprovalResponse]


class ReviewDecisionRequest(BaseModel):
    """Payload to approve or reject a pending authorization review."""

    reviewed_by: str | None = Field(default="human_operator")
    review_notes: str | None = None
