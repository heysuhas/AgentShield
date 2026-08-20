"""SQLAlchemy-backed persistence implementations for AgentShield stores."""

from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import uuid4
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.agentshield.audit import AuditEvent
from app.agentshield.intent import AuthorizedIntent, IntentValidationResult
from app.agentshield.policy_engine import Policy, PolicyViolation
from app.agentshield.risk_engine import RiskLevel
from app.agentshield.transaction import (
    VALID_TRANSITIONS,
    TransactionRecord,
    TransactionStatus,
)
from app.db.models import (
    AuditEventModel,
    AuthorizedIntentModel,
    PolicyModel,
    SessionModel,
    TransactionModel,
)
from app.providers.payments.base import PaymentResult


def _ensure_session(db: Session, session_id: str) -> None:
    """Ensure a parent session record exists to maintain foreign key integrity."""
    session = db.get(SessionModel, session_id)
    if session is None:
        session = SessionModel(
            session_id=session_id,
            status="ACTIVE",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(session)
        db.commit()


import threading

_global_session_locks: dict[str, threading.Lock] = {}
_lock_mutex = threading.Lock()


def _get_session_lock(session_id: str) -> threading.Lock:
    with _lock_mutex:
        if session_id not in _global_session_locks:
            _global_session_locks[session_id] = threading.Lock()
        return _global_session_locks[session_id]


class SqlAlchemyTransactionStore:
    """Persistent transaction store backed by SQLAlchemy."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def create(
        self,
        *,
        session_id: str,
        tool_name: str,
        amount: int | None = None,
        currency: str = "INR",
        status: TransactionStatus = TransactionStatus.REQUESTED,
        decision: str = "ALLOW",
        reasons: list[str] | None = None,
        arguments: dict[str, Any] | None = None,
    ) -> TransactionRecord:
        _ensure_session(self._db, session_id)
        transaction_id = f"txn_{uuid4().hex[:12]}"

        model = TransactionModel(
            transaction_id=transaction_id,
            session_id=session_id,
            tool_name=tool_name,
            amount=amount,
            currency=currency,
            status=status.value,
            decision=decision,
            reasons=reasons or [],
            arguments=arguments or {},
        )
        self._db.add(model)
        self._db.commit()
        self._db.refresh(model)

        return self._to_record(model)

    def get(self, transaction_id: str) -> TransactionRecord | None:
        model = self._db.get(TransactionModel, transaction_id)
        return self._to_record(model) if model else None

    def update_status(
        self,
        transaction_id: str,
        status: TransactionStatus,
        *,
        provider_order_id: str | None = None,
        error: str | None = None,
    ) -> TransactionRecord | None:
        model = self._db.get(TransactionModel, transaction_id)
        if model is None:
            return None

        lock = _get_session_lock(model.session_id)
        with lock:
            self._db.expire_all()
            model = self._db.get(TransactionModel, transaction_id)
            if model is None:
                return None

            current_status = TransactionStatus(model.status)
            valid_targets = VALID_TRANSITIONS.get(current_status, set())
            if status != current_status and status not in valid_targets:
                return None

            model.status = status.value
            model.updated_at = datetime.now(timezone.utc)
            if provider_order_id is not None:
                model.provider_order_id = provider_order_id
            if error is not None:
                model.error = error

            self._db.commit()
            self._db.refresh(model)
            return self._to_record(model)

    def list_by_session(self, session_id: str) -> list[TransactionRecord]:
        stmt = (
            select(TransactionModel)
            .where(TransactionModel.session_id == session_id)
            .order_by(TransactionModel.created_at)
        )
        models = self._db.scalars(stmt).all()
        return [self._to_record(m) for m in models]

    def list_since(self, session_id: str, since: datetime) -> list[TransactionRecord]:
        stmt = (
            select(TransactionModel)
            .where(TransactionModel.session_id == session_id)
            .where(TransactionModel.created_at >= since)
            .order_by(TransactionModel.created_at)
        )
        models = self._db.scalars(stmt).all()
        return [self._to_record(m) for m in models]

    def get_committed_spend(self, session_id: str) -> int:
        stmt = (
            select(func.coalesce(func.sum(TransactionModel.amount), 0))
            .where(TransactionModel.session_id == session_id)
            .where(TransactionModel.status == TransactionStatus.SUCCEEDED.value)
        )
        return int(self._db.scalar(stmt) or 0)

    def get_reserved_spend(self, session_id: str) -> int:
        stmt = (
            select(func.coalesce(func.sum(TransactionModel.amount), 0))
            .where(TransactionModel.session_id == session_id)
            .where(TransactionModel.status == TransactionStatus.AUTHORIZED.value)
        )
        return int(self._db.scalar(stmt) or 0)

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
        lock = _get_session_lock(session_id)
        with lock:
            self._db.expire_all()
            _ensure_session(self._db, session_id)
            transaction_id = f"txn_{uuid4().hex[:12]}"

            bind = self._db.get_bind()
            if bind is not None and bind.dialect.name == "postgresql":
                lock_stmt = (
                    select(SessionModel)
                    .where(SessionModel.session_id == session_id)
                    .with_for_update()
                )
                self._db.scalars(lock_stmt).first()

            current_spend = self.get_committed_spend(session_id) + self.get_reserved_spend(session_id)

            if (
                max_session_spend is not None
                and amount is not None
                and amount > 0
                and (current_spend + amount > max_session_spend)
            ):
                model = TransactionModel(
                    transaction_id=transaction_id,
                    session_id=session_id,
                    tool_name=tool_name,
                    amount=amount,
                    currency=currency,
                    status=TransactionStatus.BLOCKED.value,
                    decision="BLOCK",
                    reasons=["MAX_SESSION_SPEND"],
                    arguments=arguments or {},
                )
                self._db.add(model)
                self._db.commit()
                self._db.refresh(model)
                return self._to_record(model), False

            model = TransactionModel(
                transaction_id=transaction_id,
                session_id=session_id,
                tool_name=tool_name,
                amount=amount,
                currency=currency,
                status=TransactionStatus.AUTHORIZED.value,
                decision="ALLOW",
                reasons=[],
                arguments=arguments or {},
            )
            self._db.add(model)
            self._db.commit()
            self._db.refresh(model)
            return self._to_record(model), True

    def list_stale_reservations(
        self, max_age_seconds: int = 300
    ) -> list[TransactionRecord]:
        cutoff_time = datetime.now(timezone.utc) - timedelta(seconds=max_age_seconds)
        stmt = (
            select(TransactionModel)
            .where(TransactionModel.status == TransactionStatus.AUTHORIZED.value)
            .where(TransactionModel.created_at <= cutoff_time)
        )
        return [
            self._to_record(model)
            for model in self._db.scalars(stmt).all()
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
        stmt = delete(TransactionModel).where(
            TransactionModel.session_id == session_id
        )
        self._db.execute(stmt)
        self._db.commit()

    def reset(self) -> None:
        self._db.execute(delete(TransactionModel))
        self._db.commit()

    @staticmethod
    def _to_record(model: TransactionModel) -> TransactionRecord:
        return TransactionRecord(
            transaction_id=model.transaction_id,
            session_id=model.session_id,
            tool_name=model.tool_name,
            amount=model.amount,
            currency=model.currency,
            status=TransactionStatus(model.status),
            decision=model.decision,  # type: ignore
            reasons=list(model.reasons or []),
            arguments=dict(model.arguments or {}),
            provider_order_id=model.provider_order_id,
            error=model.error,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )


class SqlAlchemyAuditSink:
    """Persistent append-only audit sink backed by SQLAlchemy."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def create_and_record(
        self,
        *,
        transaction_id: str | None = None,
        transaction_status: TransactionStatus | None = None,
        session_id: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        decision: Literal["ALLOW", "BLOCK"],
        risk_score: float,
        risk_level: RiskLevel = "LOW",
        reasons: list[str] | None = None,
        policy_violations: list[PolicyViolation] | None = None,
        semantic_validation: IntentValidationResult | None = None,
        provider_name: str | None = None,
        provider_result: PaymentResult | None = None,
    ) -> AuditEvent:
        _ensure_session(self._db, session_id)
        event_id = f"evt_{uuid4().hex[:12]}"

        raw_provider_result = None
        if provider_result is not None:
            raw_provider_result = provider_result.model_dump(mode="json")

        raw_violations = [v.model_dump(mode="json") for v in (policy_violations or [])]
        raw_semantic_validation = (
            semantic_validation.model_dump(mode="json")
            if semantic_validation is not None
            else None
        )

        model = AuditEventModel(
            event_id=event_id,
            transaction_id=transaction_id,
            transaction_status=transaction_status.value if transaction_status else None,
            session_id=session_id,
            tool_name=tool_name,
            arguments=arguments or {},
            decision=decision,
            risk_score=risk_score,
            risk_level=risk_level,
            reasons=reasons or [],
            policy_violations=raw_violations,
            semantic_validation=raw_semantic_validation,
            provider_name=provider_name,
            provider_result=raw_provider_result,
            timestamp=datetime.now(timezone.utc),
        )
        self._db.add(model)
        self._db.commit()
        self._db.refresh(model)

        return self._to_event(model)

    def record(self, event: AuditEvent) -> None:
        _ensure_session(self._db, event.session_id)
        raw_provider_result = None
        if event.provider_result is not None:
            raw_provider_result = event.provider_result.model_dump(mode="json")

        raw_violations = [v.model_dump(mode="json") for v in event.policy_violations]
        raw_semantic_validation = (
            event.semantic_validation.model_dump(mode="json")
            if event.semantic_validation is not None
            else None
        )

        model = AuditEventModel(
            event_id=event.event_id,
            transaction_id=event.transaction_id,
            transaction_status=event.transaction_status.value if event.transaction_status else None,
            session_id=event.session_id,
            tool_name=event.tool_name,
            arguments=dict(event.arguments),
            decision=event.decision,
            risk_score=event.risk_score,
            risk_level=event.risk_level,
            reasons=list(event.reasons),
            policy_violations=raw_violations,
            semantic_validation=raw_semantic_validation,
            provider_name=event.provider_name,
            provider_result=raw_provider_result,
            timestamp=event.timestamp,
        )
        self._db.add(model)
        self._db.commit()

    def get(self, event_id: str) -> AuditEvent | None:
        model = self._db.get(AuditEventModel, event_id)
        return self._to_event(model) if model else None

    def list_by_session(self, session_id: str) -> list[AuditEvent]:
        stmt = (
            select(AuditEventModel)
            .where(AuditEventModel.session_id == session_id)
            .order_by(AuditEventModel.timestamp.desc())
        )
        models = self._db.scalars(stmt).all()
        return [self._to_event(m) for m in models]

    def list_all(self, limit: int = 100) -> list[AuditEvent]:
        if limit <= 0:
            return []
        stmt = select(AuditEventModel).order_by(AuditEventModel.timestamp.desc()).limit(limit)
        models = self._db.scalars(stmt).all()
        return [self._to_event(m) for m in models]

    def reset(self) -> None:
        self._db.execute(delete(AuditEventModel))
        self._db.commit()

    @staticmethod
    def _to_event(model: AuditEventModel) -> AuditEvent:
        prov_res = None
        if model.provider_result is not None:
            prov_res = PaymentResult.model_validate(model.provider_result)

        violations = [
            PolicyViolation.model_validate(v)
            for v in (model.policy_violations or [])
        ]
        semantic_validation = (
            IntentValidationResult.model_validate(model.semantic_validation)
            if model.semantic_validation is not None
            else None
        )

        return AuditEvent(
            event_id=model.event_id,
            transaction_id=model.transaction_id,
            transaction_status=TransactionStatus(model.transaction_status)
            if model.transaction_status
            else None,
            session_id=model.session_id,
            tool_name=model.tool_name,
            arguments=dict(model.arguments or {}),
            decision=model.decision,  # type: ignore
            risk_score=model.risk_score,
            risk_level=model.risk_level,  # type: ignore
            reasons=list(model.reasons or []),
            policy_violations=violations,
            semantic_validation=semantic_validation,
            provider_name=model.provider_name,
            provider_result=prov_res,
            timestamp=model.timestamp,
        )


class SqlAlchemyPolicyProvider:
    """Persistent policy provider backed by SQLAlchemy."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def get_policy(self, session_id: str) -> Policy | None:
        stmt = select(PolicyModel).where(PolicyModel.session_id == session_id)
        model = self._db.scalars(stmt).first()
        if model is None:
            return None
        return Policy(
            allowed_tools=frozenset(model.allowed_tools or []),
            max_transaction_amount=model.max_transaction_amount,
            max_session_spend=model.max_session_spend,
            max_requests_per_window=model.max_requests_per_window,
            window_seconds=model.window_seconds if model.window_seconds is not None else 60,
            max_spend_per_window=model.max_spend_per_window,
        )

    def set_policy(self, session_id: str, policy: Policy) -> None:
        _ensure_session(self._db, session_id)
        stmt = select(PolicyModel).where(PolicyModel.session_id == session_id)
        model = self._db.scalars(stmt).first()
        if model is None:
            model = PolicyModel(
                session_id=session_id,
                allowed_tools=list(policy.allowed_tools),
                max_transaction_amount=policy.max_transaction_amount,
                max_session_spend=policy.max_session_spend,
                max_requests_per_window=policy.max_requests_per_window,
                window_seconds=policy.window_seconds,
                max_spend_per_window=policy.max_spend_per_window,
            )
            self._db.add(model)
        else:
            model.allowed_tools = list(policy.allowed_tools)
            model.max_transaction_amount = policy.max_transaction_amount
            model.max_session_spend = policy.max_session_spend
            model.max_requests_per_window = policy.max_requests_per_window
            model.window_seconds = policy.window_seconds
            model.max_spend_per_window = policy.max_spend_per_window

        self._db.commit()

    def remove_policy(self, session_id: str) -> None:
        stmt = select(PolicyModel).where(PolicyModel.session_id == session_id)
        model = self._db.scalars(stmt).first()
        if model is not None:
            self._db.delete(model)
            self._db.commit()

    def has_session(self, session_id: str) -> bool:
        stmt = select(PolicyModel).where(PolicyModel.session_id == session_id)
        return self._db.scalars(stmt).first() is not None

    def list_sessions(self) -> list[str]:
        stmt = select(PolicyModel.session_id)
        return list(self._db.scalars(stmt).all())

    def reset(self) -> None:
        self._db.execute(delete(PolicyModel))
        self._db.commit()


class SqlAlchemyIntentProvider:
    """Persistent authorized intent provider backed by SQLAlchemy."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def get_intent(self, session_id: str) -> AuthorizedIntent | None:
        stmt = select(AuthorizedIntentModel).where(
            AuthorizedIntentModel.session_id == session_id
        )
        model = self._db.scalars(stmt).first()
        if model is None:
            return None
        return AuthorizedIntent(
            category=model.category,
            purpose=model.purpose,
            recipient=model.recipient,
            merchant=model.merchant,
            max_amount=model.max_amount,
            currency=model.currency,
            allowed_tools=frozenset(model.allowed_tools)
            if model.allowed_tools is not None
            else None,
            constraints=dict(model.constraints or {}),
        )

    def set_intent(self, session_id: str, intent: AuthorizedIntent) -> None:
        _ensure_session(self._db, session_id)
        stmt = select(AuthorizedIntentModel).where(
            AuthorizedIntentModel.session_id == session_id
        )
        model = self._db.scalars(stmt).first()
        if model is None:
            model = AuthorizedIntentModel(
                session_id=session_id,
                category=intent.category,
                purpose=intent.purpose,
                recipient=intent.recipient,
                merchant=intent.merchant,
                max_amount=intent.max_amount,
                currency=intent.currency,
                allowed_tools=list(intent.allowed_tools)
                if intent.allowed_tools is not None
                else None,
                constraints=dict(intent.constraints),
            )
            self._db.add(model)
        else:
            model.category = intent.category
            model.purpose = intent.purpose
            model.recipient = intent.recipient
            model.merchant = intent.merchant
            model.max_amount = intent.max_amount
            model.currency = intent.currency
            model.allowed_tools = (
                list(intent.allowed_tools)
                if intent.allowed_tools is not None
                else None
            )
            model.constraints = dict(intent.constraints)

        self._db.commit()

    def remove_intent(self, session_id: str) -> None:
        stmt = select(AuthorizedIntentModel).where(
            AuthorizedIntentModel.session_id == session_id
        )
        model = self._db.scalars(stmt).first()
        if model is not None:
            self._db.delete(model)
            self._db.commit()

    def has_intent(self, session_id: str) -> bool:
        stmt = select(AuthorizedIntentModel).where(
            AuthorizedIntentModel.session_id == session_id
        )
        return self._db.scalars(stmt).first() is not None

    def reset(self) -> None:
        self._db.execute(delete(AuthorizedIntentModel))
        self._db.commit()
