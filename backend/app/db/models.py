"""SQLAlchemy ORM models for AgentShield entities."""

from datetime import datetime, timezone
from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SessionModel(Base):
    """Represents an agent session."""

    __tablename__ = "sessions"

    session_id: Mapped[str] = mapped_column(
        String(128), primary_key=True, index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now
    )


class PolicyModel(Base):
    """Represents a session security policy."""

    __tablename__ = "policies"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True
    )
    session_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("sessions.session_id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    allowed_tools: Mapped[list] = mapped_column(JSON, default=list)
    max_transaction_amount: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    max_session_spend: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now
    )


class AuthorizedIntentModel(Base):
    """Represents an authorized user intent for a session."""

    __tablename__ = "authorized_intents"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True
    )
    session_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("sessions.session_id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    purpose: Mapped[str | None] = mapped_column(String(256), nullable=True)
    recipient: Mapped[str | None] = mapped_column(String(128), nullable=True)
    merchant: Mapped[str | None] = mapped_column(String(128), nullable=True)
    max_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(16), default="INR")
    allowed_tools: Mapped[list | None] = mapped_column(JSON, nullable=True)
    constraints: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now
    )


class TransactionModel(Base):
    """Represents a transaction and its authorization / settlement state."""

    __tablename__ = "transactions"

    transaction_id: Mapped[str] = mapped_column(
        String(128), primary_key=True, index=True
    )
    session_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("sessions.session_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(16), default="INR")
    status: Mapped[str] = mapped_column(
        String(32), index=True, nullable=False
    )
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    arguments: Mapped[dict] = mapped_column(JSON, default=dict)
    provider_order_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, onupdate=_utc_now
    )


class AuditEventModel(Base):
    """Represents an immutable audit trail event."""

    __tablename__ = "audit_events"

    event_id: Mapped[str] = mapped_column(
        String(128), primary_key=True, index=True
    )
    transaction_id: Mapped[str | None] = mapped_column(
        String(128), index=True, nullable=True
    )
    transaction_status: Mapped[str | None] = mapped_column(
        String(32), nullable=True
    )
    session_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("sessions.session_id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    arguments: Mapped[dict] = mapped_column(JSON, default=dict)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    risk_score: Mapped[float] = mapped_column(Float, default=0.0)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    policy_violations: Mapped[list] = mapped_column(JSON, default=list)
    provider_name: Mapped[str | None] = mapped_column(
        String(128), nullable=True
    )
    provider_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utc_now, index=True
    )
