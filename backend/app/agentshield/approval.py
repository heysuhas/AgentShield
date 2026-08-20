"""Human approval domain models, statuses, and storage protocols."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol
from uuid import uuid4
from pydantic import BaseModel, ConfigDict, Field


class ApprovalStatus(str, Enum):
    """The review lifecycle status for a sensitive transaction."""

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ApprovalRecord(BaseModel):
    """Represents a human authorization request for an in-flight tool call."""

    model_config = ConfigDict(frozen=True)

    approval_id: str
    transaction_id: str
    session_id: str
    status: ApprovalStatus = ApprovalStatus.PENDING
    tool_name: str
    amount: int | None = None
    currency: str = "INR"
    arguments: dict[str, Any] = Field(default_factory=dict)
    risk_score: float = 0.0
    risk_level: str = "MEDIUM"
    reasons: list[str] = Field(default_factory=list)
    reviewed_by: str | None = None
    review_notes: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ApprovalStore(Protocol):
    """Protocol for storing and transitioning human approval records."""

    def create(
        self,
        *,
        transaction_id: str,
        session_id: str,
        tool_name: str,
        amount: int | None,
        currency: str = "INR",
        arguments: dict[str, Any] | None = None,
        risk_score: float = 0.0,
        risk_level: str = "MEDIUM",
        reasons: list[str] | None = None,
    ) -> ApprovalRecord:
        """Create a new pending approval record."""
        ...

    def get(self, approval_id: str) -> ApprovalRecord | None:
        """Retrieve an approval record by its ID."""
        ...

    def get_by_transaction(self, transaction_id: str) -> ApprovalRecord | None:
        """Retrieve an approval record by its associated transaction ID."""
        ...

    def update_status(
        self,
        approval_id: str,
        *,
        status: ApprovalStatus,
        reviewed_by: str | None = None,
        review_notes: str | None = None,
    ) -> ApprovalRecord | None:
        """Update the review status of an approval record."""
        ...

    def list_approvals(
        self,
        *,
        session_id: str | None = None,
        status: ApprovalStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ApprovalRecord]:
        """List approval records with optional filtering."""
        ...


class InMemoryApprovalStore:
    """Thread-safe in-memory approval store implementation."""

    def __init__(self) -> None:
        self._approvals: dict[str, ApprovalRecord] = {}

    def create(
        self,
        *,
        transaction_id: str,
        session_id: str,
        tool_name: str,
        amount: int | None,
        currency: str = "INR",
        arguments: dict[str, Any] | None = None,
        risk_score: float = 0.0,
        risk_level: str = "MEDIUM",
        reasons: list[str] | None = None,
    ) -> ApprovalRecord:
        appr_id = f"appr_{uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)
        record = ApprovalRecord(
            approval_id=appr_id,
            transaction_id=transaction_id,
            session_id=session_id,
            status=ApprovalStatus.PENDING,
            tool_name=tool_name,
            amount=amount,
            currency=currency,
            arguments=dict(arguments or {}),
            risk_score=risk_score,
            risk_level=risk_level,
            reasons=list(reasons or []),
            created_at=now,
            updated_at=now,
        )
        self._approvals[appr_id] = record
        return record

    def get(self, approval_id: str) -> ApprovalRecord | None:
        return self._approvals.get(approval_id)

    def get_by_transaction(self, transaction_id: str) -> ApprovalRecord | None:
        for a in self._approvals.values():
            if a.transaction_id == transaction_id:
                return a
        return None

    def update_status(
        self,
        approval_id: str,
        *,
        status: ApprovalStatus,
        reviewed_by: str | None = None,
        review_notes: str | None = None,
    ) -> ApprovalRecord | None:
        record = self._approvals.get(approval_id)
        if record is None:
            return None

        updated = record.model_copy(
            update={
                "status": status,
                "reviewed_by": reviewed_by,
                "review_notes": review_notes,
                "updated_at": datetime.now(timezone.utc),
            }
        )
        self._approvals[approval_id] = updated
        return updated

    def list_approvals(
        self,
        *,
        session_id: str | None = None,
        status: ApprovalStatus | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ApprovalRecord]:
        items = list(self._approvals.values())
        if session_id is not None:
            items = [a for a in items if a.session_id == session_id]
        if status is not None:
            items = [a for a in items if a.status == status]
        items.sort(key=lambda a: a.created_at, reverse=True)
        return items[offset : offset + limit]
