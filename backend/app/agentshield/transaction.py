from datetime import datetime, timezone
from enum import Enum
from threading import RLock
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


VALID_TRANSITIONS: dict[TransactionStatus, set[TransactionStatus]] = {
    TransactionStatus.REQUESTED: {
        TransactionStatus.AUTHORIZED,
        TransactionStatus.BLOCKED,
        TransactionStatus.CANCELLED,
    },
    TransactionStatus.AUTHORIZED: {
        TransactionStatus.SUCCEEDED,
        TransactionStatus.FAILED,
        TransactionStatus.CANCELLED,
        TransactionStatus.PENDING,
    },
    TransactionStatus.PENDING: {
        TransactionStatus.SUCCEEDED,
        TransactionStatus.FAILED,
        TransactionStatus.CANCELLED,
    },
    TransactionStatus.BLOCKED: set(),
    TransactionStatus.SUCCEEDED: set(),
    TransactionStatus.FAILED: set(),
    TransactionStatus.CANCELLED: set(),
}


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

    def list_since(self, session_id: str, since: datetime) -> list[TransactionRecord]:
        """List transactions for a session created at or after the specified timestamp."""
        ...

    def get_committed_spend(self, session_id: str) -> int:
        """Calculate total settled/committed spend for a session."""
        ...

    def get_reserved_spend(self, session_id: str) -> int:
        """Calculate total in-flight reserved spend for a session."""
        ...

    def reserve_and_authorize(
        self,
        *,
        session_id: str,
        tool_name: str,
        amount: int | None,
        currency: str = "INR",
        max_session_spend: int | None = None,
        arguments: dict[str, Any] | None = None,
    ) -> tuple[TransactionRecord, bool]:
        """Atomically check session spend limit, reserve spend, and create transaction record."""
        ...

    def list_stale_reservations(
        self, max_age_seconds: int = 300
    ) -> list[TransactionRecord]:
        """List AUTHORIZED transactions older than max_age_seconds."""
        ...

    def expire_stale_reservations(
        self, max_age_seconds: int = 300
    ) -> list[TransactionRecord]:
        """Expire stale AUTHORIZED transactions older than max_age_seconds."""
        ...

    def reset_session(self, session_id: str) -> None:
        """Clear all transactions for a specific session."""
        ...

    def reset(self) -> None:
        """Clear all transactions and reset state."""
        ...


class InMemoryTransactionStore:
    """In-memory storage for transaction records."""

    def __init__(self) -> None:
        self._transactions: dict[str, TransactionRecord] = {}
        self._counter: int = 0
        self._reservation_lock = RLock()

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

    def reserve_and_authorize(
        self,
        *,
        session_id: str,
        tool_name: str,
        amount: int | None,
        currency: str = "INR",
        max_session_spend: int | None = None,
        arguments: dict[str, Any] | None = None,
    ) -> tuple[TransactionRecord, bool]:
        with self._reservation_lock:
            current_spend = self.get_committed_spend(session_id) + self.get_reserved_spend(session_id)
            if (
                max_session_spend is not None
                and amount is not None
                and amount > 0
                and (current_spend + amount > max_session_spend)
            ):
                record = self.create(
                    session_id=session_id,
                    tool_name=tool_name,
                    amount=amount,
                    currency=currency,
                    status=TransactionStatus.BLOCKED,
                    decision="BLOCK",
                    reasons=["MAX_SESSION_SPEND"],
                    arguments=arguments,
                )
                return record, False

            record = self.create(
                session_id=session_id,
                tool_name=tool_name,
                amount=amount,
                currency=currency,
                status=TransactionStatus.AUTHORIZED,
                decision="ALLOW",
                reasons=[],
                arguments=arguments,
            )
            return record, True

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
        with self._reservation_lock:
            record = self._transactions.get(transaction_id)
            if not record:
                return None

            # Validate state transition
            valid_targets = VALID_TRANSITIONS.get(record.status, set())
            if status != record.status and status not in valid_targets:
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

    def list_since(self, session_id: str, since: datetime) -> list[TransactionRecord]:
        with self._reservation_lock:
            return [
                t
                for t in self._transactions.values()
                if t.session_id == session_id and t.created_at >= since
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
            and t.status in (TransactionStatus.AUTHORIZED, TransactionStatus.PENDING)
        )

    def list_stale_reservations(
        self, max_age_seconds: int = 300
    ) -> list[TransactionRecord]:
        cutoff = datetime.now(timezone.utc).timestamp() - max_age_seconds
        with self._reservation_lock:
            return [
                txn
                for txn in self._transactions.values()
                if txn.status == TransactionStatus.AUTHORIZED
                and txn.created_at.timestamp() <= cutoff
            ]

    def expire_stale_reservations(
        self, max_age_seconds: int = 300
    ) -> list[TransactionRecord]:
        expired: list[TransactionRecord] = []
        for txn in self.list_stale_reservations(max_age_seconds):
            updated = self.update_status(
                txn.transaction_id,
                status=TransactionStatus.CANCELLED,
                error="RESERVATION_EXPIRED",
            )
            if updated:
                expired.append(updated)
        return expired

    def reset_session(self, session_id: str) -> None:
        self._transactions = {
            k: v for k, v in self._transactions.items() if v.session_id != session_id
        }

    def reset(self) -> None:
        """Clear all transactions and reset counter."""
        self._transactions.clear()
        self._counter = 0
