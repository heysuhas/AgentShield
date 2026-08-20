"""Schemas for querying and displaying transactions."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class TransactionResponse(BaseModel):
    """Structured transaction response."""

    transaction_id: str
    session_id: str
    tool_name: str
    amount: int | None = None
    currency: str = "INR"
    status: str
    decision: str
    reasons: list[str] = Field(default_factory=list)
    arguments: dict[str, Any] = Field(default_factory=dict)
    provider_order_id: str | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class PaginatedTransactionResponse(BaseModel):
    """Paginated list of transactions."""

    total: int
    limit: int
    offset: int
    items: list[TransactionResponse]
