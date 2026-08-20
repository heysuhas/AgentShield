"""Transaction lifecycle state model and in-memory store."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field


class TransactionStatus(str, Enum):
    """Explicit states in an AgentShield financial transaction lifecycle."""

    REQUESTED = "REQUESTED"
    AUTHORIZED = "AUTHORIZED"
    BLOCKED = "BLOCKED"
    PENDING = "PENDING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class TransactionRecord(BaseModel):
    """Complete record of an authorized or blocked tool request."""

    transaction_id: str
    session_id: str
    tool_name: str
    amount: int | None = None
    currency: str = "INR"
    status: TransactionStatus
    decision: str
    reasons: list[str] = Field(default_factory=list)
    arguments: dict[str, Any] = Field(default_factory=dict)
    provider_order_id: str | None = None
    error: str | None = None
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


@runtime_checkable
class TransactionStore(Protocol):
    """Protocol for transaction record persistence and querying."""

    def create(
        self,
        *,
        session_id: str,
        tool_name: str,
        amount: int | None,
        currency: str = "INR",
        status: TransactionStatus,
        decision: str,
        reasons: list[str] | None = None,
        arguments: dict[str, Any] | None = None,
    ) -> TransactionRecord:
        """Create and store a new transaction record."""
        ...

    def get(self, transaction_id: str) -> TransactionRecord | None:
        """Fetch a transaction record by its ID."""
        ...

    def update_status(
        self,
        transaction_id: str,
        *,
        status: TransactionStatus,
        provider_order_id: str | None = None,
        error: str | None = None,
    ) -> TransactionRecord | None:
        """Update the status and provider metadata for a transaction."""
        ...

    def list_by_session(self, session_id: str) -> list[TransactionRecord]:
        """List all transactions for a given session."""
        ...

    def get_committed_spend(self, session_id: str) -> int:
        """Calculate total settled/committed spend for a session."""
        ...

    def get_reserved_spend(self, session_id: str) -> int:
        """Calculate total in-flight reserved spend for a session."""
        ...


class InMemoryTransactionStore:
    """In-memory storage for transaction records."""

    def __init__(self) -> None:
        self._transactions: dict[str, TransactionRecord] = {}
        self._counter: int = 0

    def create(
        self,
        *,
        session_id: str,
        tool_name: str,
        amount: int | None,
        currency: str = "INR",
        status: TransactionStatus,
        decision: str,
        reasons: list[str] | None = None,
        arguments: dict[str, Any] | None = None,
    ) -> TransactionRecord:
        self._counter += 1
        txn_id = f"txn_{self._counter:06d}"
        now = datetime.now(timezone.utc)
        record = TransactionRecord(
            transaction_id=txn_id,
            session_id=session_id,
            tool_name=tool_name,
            amount=amount,
            currency=currency,
            status=status,
            decision=decision,
            reasons=reasons or [],
            arguments=arguments or {},
            created_at=now,
            updated_at=now,
        )
        self._transactions[txn_id] = record
        return record

    def get(self, transaction_id: str) -> TransactionRecord | None:
        return self._transactions.get(transaction_id)

    def update_status(
        self,
        transaction_id: str,
        *,
        status: TransactionStatus,
        provider_order_id: str | None = None,
        error: str | None = None,
    ) -> TransactionRecord | None:
        record = self._transactions.get(transaction_id)
        if not record:
            return None

        update_data: dict[str, Any] = {
            "status": status,
            "updated_at": datetime.now(timezone.utc),
        }
        if provider_order_id is not None:
            update_data["provider_order_id"] = provider_order_id
        if error is not None:
            update_data["error"] = error

        updated_record = record.model_copy(update=update_data)
        self._transactions[transaction_id] = updated_record
        return updated_record

    def list_by_session(self, session_id: str) -> list[TransactionRecord]:
        return [
            t
            for t in self._transactions.values()
            if t.session_id == session_id
        ]

    def get_committed_spend(self, session_id: str) -> int:
        return sum(
            t.amount or 0
            for t in self._transactions.values()
            if t.session_id == session_id
            and t.status == TransactionStatus.SUCCEEDED
        )

    def get_reserved_spend(self, session_id: str) -> int:
        return sum(
            t.amount or 0
            for t in self._transactions.values()
            if t.session_id == session_id
            and t.status == TransactionStatus.AUTHORIZED
        )

    def reset(self) -> None:
        """Clear all transactions and reset counter."""
        self._transactions.clear()
        self._counter = 0
