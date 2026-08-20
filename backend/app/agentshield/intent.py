"""Authorized user intent models and structured validation evidence."""

from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class AuthorizedIntent(BaseModel):
    """The structured authorized intent established by the user."""

    model_config = ConfigDict(frozen=True)

    category: str | None = None
    purpose: str | None = None
    recipient: str | None = None
    merchant: str | None = None
    max_amount: int | None = Field(default=None, ge=0)
    currency: str = "INR"
    allowed_tools: frozenset[str] | None = None
    constraints: dict[str, Any] = Field(default_factory=dict)


class IntentValidationResult(BaseModel):
    """Structured validation evidence comparing an action against authorized intent."""

    model_config = ConfigDict(frozen=True)

    intent_match: bool
    category_match: bool = True
    purpose_match: bool = True
    recipient_match: bool = True
    merchant_match: bool = True
    amount_within_limit: bool = True
    currency_match: bool = True
    tool_match: bool = True
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    reasons: list[str] = Field(default_factory=list)
    explanation: str | None = None
