"""API endpoints for querying transactions."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db.models import TransactionModel
from app.schemas.transaction import PaginatedTransactionResponse, TransactionResponse

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("", response_model=PaginatedTransactionResponse)
def list_transactions(
    session_id: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    decision: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> PaginatedTransactionResponse:
    """Retrieve transactions with optional filters and pagination."""
    query = select(TransactionModel)

    if session_id is not None:
        query = query.where(TransactionModel.session_id == session_id)
    if status_filter is not None:
        query = query.where(TransactionModel.status == status_filter)
    if decision is not None:
        query = query.where(TransactionModel.decision == decision)

    # Count total matching rows
    count_query = select(func.count()).select_from(query.subquery())
    total = int(db.scalar(count_query) or 0)

    # Fetch paginated items ordered newest first
    stmt = query.order_by(TransactionModel.created_at.desc()).limit(limit).offset(offset)
    models = db.scalars(stmt).all()

    items = [
        TransactionResponse(
            transaction_id=m.transaction_id,
            session_id=m.session_id,
            tool_name=m.tool_name,
            amount=m.amount,
            currency=m.currency,
            status=m.status,
            decision=m.decision,
            reasons=list(m.reasons or []),
            arguments=dict(m.arguments or {}),
            provider_order_id=m.provider_order_id,
            error=m.error,
            created_at=m.created_at,
            updated_at=m.updated_at,
        )
        for m in models
    ]

    return PaginatedTransactionResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=items,
    )


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(
    transaction_id: str,
    db: Session = Depends(get_db),
) -> TransactionResponse:
    """Retrieve a single transaction record by its ID."""
    model = db.get(TransactionModel, transaction_id)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction '{transaction_id}' not found",
        )

    return TransactionResponse(
        transaction_id=model.transaction_id,
        session_id=model.session_id,
        tool_name=model.tool_name,
        amount=model.amount,
        currency=model.currency,
        status=model.status,
        decision=model.decision,
        reasons=list(model.reasons or []),
        arguments=dict(model.arguments or {}),
        provider_order_id=model.provider_order_id,
        error=model.error,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )
