"""API endpoints for querying security audit events."""

from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agentshield.executor import AgentShield
from app.api.deps import get_db, get_shield
from app.db.models import AuditEventModel
from app.schemas.audit import AuditEventResponse, PaginatedAuditResponse

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=PaginatedAuditResponse)
@router.get("/events", response_model=PaginatedAuditResponse)
def list_audit_events(
    session_id: str | None = None,
    decision: Literal["ALLOW", "BLOCK", "REVIEW"] | None = None,
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> PaginatedAuditResponse:
    """Retrieve security audit events with optional filters and pagination."""
    query = select(AuditEventModel)

    if session_id is not None:
        query = query.where(AuditEventModel.session_id == session_id)
    if decision is not None:
        query = query.where(AuditEventModel.decision == decision)
    if risk_level is not None:
        query = query.where(AuditEventModel.risk_level == risk_level)

    # Count total matching rows
    count_query = select(func.count()).select_from(query.subquery())
    total = int(db.scalar(count_query) or 0)

    # Fetch paginated items ordered newest first
    stmt = query.order_by(AuditEventModel.timestamp.desc()).limit(limit).offset(offset)
    models = db.scalars(stmt).all()

    items = [
        AuditEventResponse(
            event_id=m.event_id,
            transaction_id=m.transaction_id,
            transaction_status=m.transaction_status,
            session_id=m.session_id,
            tool_name=m.tool_name,
            arguments=dict(m.arguments or {}),
            decision=m.decision,  # type: ignore
            risk_score=m.risk_score,
            risk_level=m.risk_level,
            reasons=list(m.reasons or []),
            policy_violations=list(m.policy_violations or []),
            semantic_validation=m.semantic_validation,
            provider_name=m.provider_name,
            provider_result=m.provider_result,
            timestamp=m.timestamp,
        )
        for m in models
    ]

    return PaginatedAuditResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=items,
    )


@router.get("/{event_id}", response_model=AuditEventResponse)
def get_audit_event(
    event_id: str,
    db: Session = Depends(get_db),
) -> AuditEventResponse:
    """Retrieve a single audit event by its ID."""
    model = db.get(AuditEventModel, event_id)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Audit event '{event_id}' not found",
        )

    return AuditEventResponse(
        event_id=model.event_id,
        transaction_id=model.transaction_id,
        transaction_status=model.transaction_status,
        session_id=model.session_id,
        tool_name=model.tool_name,
        arguments=dict(model.arguments or {}),
        decision=model.decision,  # type: ignore
        risk_score=model.risk_score,
        risk_level=model.risk_level,
        reasons=list(model.reasons or []),
        policy_violations=list(model.policy_violations or []),
        semantic_validation=model.semantic_validation,
        provider_name=model.provider_name,
        provider_result=model.provider_result,
        timestamp=model.timestamp,
    )
