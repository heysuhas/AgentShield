"""API endpoints for human authorization approval workflows."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agentshield.executor import AgentShield
from app.api.deps import get_db, get_shield
from app.db.models import ApprovalModel
from app.schemas.approval import (
    ApprovalResponse,
    PaginatedApprovalResponse,
    ReviewDecisionRequest,
)
from app.schemas.tool_execution import ExecuteToolResponse

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("", response_model=PaginatedApprovalResponse)
def list_approvals(
    session_id: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> PaginatedApprovalResponse:
    """List pending and historical human review requests with optional filters."""
    query = select(ApprovalModel)

    if session_id is not None:
        query = query.where(ApprovalModel.session_id == session_id)
    if status_filter is not None:
        query = query.where(ApprovalModel.status == status_filter)

    count_query = select(func.count()).select_from(query.subquery())
    total = int(db.scalar(count_query) or 0)

    stmt = query.order_by(ApprovalModel.created_at.desc()).limit(limit).offset(offset)
    models = db.scalars(stmt).all()

    items = [
        ApprovalResponse(
            approval_id=m.approval_id,
            transaction_id=m.transaction_id,
            session_id=m.session_id,
            status=m.status,
            tool_name=m.tool_name,
            amount=m.amount,
            currency=m.currency,
            arguments=dict(m.arguments or {}),
            risk_score=m.risk_score,
            risk_level=m.risk_level,
            reasons=list(m.reasons or []),
            reviewed_by=m.reviewed_by,
            review_notes=m.review_notes,
            created_at=m.created_at,
            updated_at=m.updated_at,
        )
        for m in models
    ]

    return PaginatedApprovalResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=items,
    )


@router.get("/{approval_id}", response_model=ApprovalResponse)
def get_approval(
    approval_id: str,
    db: Session = Depends(get_db),
) -> ApprovalResponse:
    """Fetch details of a single human approval record."""
    stmt = select(ApprovalModel).where(ApprovalModel.approval_id == approval_id)
    model = db.scalars(stmt).first()
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Approval '{approval_id}' not found",
        )

    return ApprovalResponse(
        approval_id=model.approval_id,
        transaction_id=model.transaction_id,
        session_id=model.session_id,
        status=model.status,
        tool_name=model.tool_name,
        amount=model.amount,
        currency=model.currency,
        arguments=dict(model.arguments or {}),
        risk_score=model.risk_score,
        risk_level=model.risk_level,
        reasons=list(model.reasons or []),
        reviewed_by=model.reviewed_by,
        review_notes=model.review_notes,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


@router.post("/{approval_id}/approve", response_model=ExecuteToolResponse)
def approve_request(
    approval_id: str,
    payload: ReviewDecisionRequest | None = None,
    shield: AgentShield = Depends(get_shield),
) -> ExecuteToolResponse:
    """Human operator authorization: approve a pending transaction and execute payment."""
    reviewed_by = payload.reviewed_by if payload else "human_operator"
    review_notes = payload.review_notes if payload else None

    try:
        res = shield.approve_transaction(
            approval_id,
            reviewed_by=reviewed_by,
            review_notes=review_notes,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return ExecuteToolResponse(
        decision=res.decision,
        session_id=res.session_id,
        tool_name=res.tool_name,
        risk_score=res.risk_score,
        risk_level=res.risk_level,
        reasons=res.reasons,
        policy_violations=res.policy_violations,
        intent_validation=res.intent_validation,
        semantic_validation=res.semantic_validation,
        provider_result=res.provider_result,
        transaction_id=res.transaction_id,
        transaction_status=res.transaction_status,
        approval_id=res.approval_id,
        error=res.error,
    )


@router.post("/{approval_id}/reject", response_model=ExecuteToolResponse)
def reject_request(
    approval_id: str,
    payload: ReviewDecisionRequest | None = None,
    shield: AgentShield = Depends(get_shield),
) -> ExecuteToolResponse:
    """Human operator rejection: reject a pending transaction and cancel reserved spend."""
    reviewed_by = payload.reviewed_by if payload else "human_operator"
    review_notes = payload.review_notes if payload else None

    try:
        res = shield.reject_transaction(
            approval_id,
            reviewed_by=reviewed_by,
            review_notes=review_notes,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return ExecuteToolResponse(
        decision=res.decision,
        session_id=res.session_id,
        tool_name=res.tool_name,
        risk_score=res.risk_score,
        risk_level=res.risk_level,
        reasons=res.reasons,
        policy_violations=res.policy_violations,
        intent_validation=res.intent_validation,
        semantic_validation=res.semantic_validation,
        provider_result=res.provider_result,
        transaction_id=res.transaction_id,
        transaction_status=res.transaction_status,
        approval_id=res.approval_id,
        error=res.error,
    )
