"""API router for session lifecycle management."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.agentshield.executor import AgentShield
from app.agentshield.intent import AuthorizedIntent
from app.agentshield.policy_engine import Policy
from app.api.deps import get_shield
from app.db.session import get_db
from app.schemas.session import (
    CreateSessionRequest,
    IntentSchema,
    PolicySchema,
    SessionResponse,
    SetSessionIntentRequest,
    SetSessionPolicyRequest,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _to_policy_schema(policy: Policy | None) -> PolicySchema | None:
    if policy is None:
        return None
    return PolicySchema(
        allowed_tools=sorted(list(policy.allowed_tools)),
        max_transaction_amount=policy.max_transaction_amount,
        max_session_spend=policy.max_session_spend,
        max_requests_per_window=policy.max_requests_per_window,
        window_seconds=policy.window_seconds,
        max_spend_per_window=policy.max_spend_per_window,
    )


def _to_policy(schema: PolicySchema) -> Policy:
    return Policy(
        allowed_tools=frozenset(schema.allowed_tools),
        max_transaction_amount=schema.max_transaction_amount,
        max_session_spend=schema.max_session_spend,
        max_requests_per_window=schema.max_requests_per_window,
        window_seconds=schema.window_seconds,
        max_spend_per_window=schema.max_spend_per_window,
    )


def _to_intent_schema(intent: AuthorizedIntent | None) -> IntentSchema | None:
    if intent is None:
        return None
    return IntentSchema(
        category=intent.category,
        purpose=intent.purpose,
        recipient=intent.recipient,
        merchant=intent.merchant,
        max_amount=intent.max_amount,
        currency=intent.currency,
        allowed_tools=sorted(list(intent.allowed_tools))
        if intent.allowed_tools
        else None,
        constraints=dict(intent.constraints),
    )


def _to_intent(schema: IntentSchema) -> AuthorizedIntent:
    return AuthorizedIntent(
        category=schema.category,
        purpose=schema.purpose,
        recipient=schema.recipient,
        merchant=schema.merchant,
        max_amount=schema.max_amount,
        currency=schema.currency,
        allowed_tools=frozenset(schema.allowed_tools)
        if schema.allowed_tools is not None
        else None,
        constraints=dict(schema.constraints),
    )


@router.post(
    "",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    request: CreateSessionRequest,
    shield: AgentShield = Depends(get_shield),
) -> SessionResponse:
    """Create a new session with an optional policy and intent."""
    if hasattr(shield.policy_provider, "has_session") and shield.policy_provider.has_session(request.session_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Session '{request.session_id}' already exists",
        )

    policy = (
        _to_policy(request.policy)
        if request.policy is not None
        else Policy()
    )
    if hasattr(shield.policy_provider, "set_policy"):
        shield.policy_provider.set_policy(request.session_id, policy)

    if request.intent is not None and hasattr(shield.intent_provider, "set_intent"):
        shield.intent_provider.set_intent(
            request.session_id, _to_intent(request.intent)
        )

    saved_policy = shield.policy_provider.get_policy(request.session_id)
    saved_intent = shield.intent_provider.get_intent(request.session_id)
    return SessionResponse(
        session_id=request.session_id,
        status="ACTIVE",
        policy=_to_policy_schema(saved_policy),
        intent=_to_intent_schema(saved_intent),
        committed_spend=shield.get_committed_spend(request.session_id),
        reserved_spend=shield.get_reserved_spend(request.session_id),
        total_active_spend=shield.get_session_spend(request.session_id),
    )


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
    session_id: str,
    shield: AgentShield = Depends(get_shield),
) -> SessionResponse:
    """Retrieve session details, active policy, intent, and spend metrics."""
    if (
        hasattr(shield.policy_provider, "has_session")
        and not shield.policy_provider.has_session(session_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    policy = shield.policy_provider.get_policy(session_id)
    intent = shield.intent_provider.get_intent(session_id)
    return SessionResponse(
        session_id=session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        intent=_to_intent_schema(intent),
        committed_spend=shield.get_committed_spend(session_id),
        reserved_spend=shield.get_reserved_spend(session_id),
        total_active_spend=shield.get_session_spend(session_id),
    )


@router.put("/{session_id}/policy", response_model=SessionResponse)
def set_session_policy(
    session_id: str,
    request: SetSessionPolicyRequest,
    shield: AgentShield = Depends(get_shield),
) -> SessionResponse:
    """Register or update a policy for a session."""
    policy = _to_policy(request.policy)
    if hasattr(shield.policy_provider, "set_policy"):
        shield.policy_provider.set_policy(session_id, policy)

    intent = shield.intent_provider.get_intent(session_id)
    return SessionResponse(
        session_id=session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        intent=_to_intent_schema(intent),
        committed_spend=shield.get_committed_spend(session_id),
        reserved_spend=shield.get_reserved_spend(session_id),
        total_active_spend=shield.get_session_spend(session_id),
    )


@router.put("/{session_id}/intent", response_model=SessionResponse)
def set_session_intent(
    session_id: str,
    request: SetSessionIntentRequest,
    shield: AgentShield = Depends(get_shield),
) -> SessionResponse:
    """Register or update authorized user intent for a session."""
    if (
        hasattr(shield.policy_provider, "has_session")
        and not shield.policy_provider.has_session(session_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    intent = _to_intent(request.intent)
    if hasattr(shield.intent_provider, "set_intent"):
        shield.intent_provider.set_intent(session_id, intent)

    policy = shield.policy_provider.get_policy(session_id)
    return SessionResponse(
        session_id=session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        intent=_to_intent_schema(intent),
        committed_spend=shield.get_committed_spend(session_id),
        reserved_spend=shield.get_reserved_spend(session_id),
        total_active_spend=shield.get_session_spend(session_id),
    )


@router.post("/{session_id}/reset", response_model=SessionResponse)
def reset_session_spend(
    session_id: str,
    shield: AgentShield = Depends(get_shield),
) -> SessionResponse:
    """Reset the cumulative spend metrics for a session."""
    if (
        hasattr(shield.policy_provider, "has_session")
        and not shield.policy_provider.has_session(session_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    shield.reset_session_spend(session_id)
    policy = shield.policy_provider.get_policy(session_id)
    intent = shield.intent_provider.get_intent(session_id)
    return SessionResponse(
        session_id=session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        intent=_to_intent_schema(intent),
        committed_spend=0,
        reserved_spend=0,
        total_active_spend=0,
    )


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    shield: AgentShield = Depends(get_shield),
) -> None:
    """Delete a session policy and clear tracked spend."""
    if (
        hasattr(shield.policy_provider, "has_session")
        and not shield.policy_provider.has_session(session_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    if hasattr(shield.policy_provider, "remove_policy"):
        shield.policy_provider.remove_policy(session_id)
    if hasattr(shield.intent_provider, "remove_intent"):
        shield.intent_provider.remove_intent(session_id)
    shield.reset_session_spend(session_id)


class ReconcileResponse(BaseModel):
    reconciled_count: int
    reconciled_transactions: list[str]


@router.post("/reconcile", response_model=ReconcileResponse)
def reconcile_all_sessions(
    max_age_seconds: int = 300,
    shield: AgentShield = Depends(get_shield),
) -> ReconcileResponse:
    """Reconcile and recover stale in-flight AUTHORIZED reservations across all sessions."""
    records = shield.reconcile_stale_reservations(max_age_seconds=max_age_seconds)
    return ReconcileResponse(
        reconciled_count=len(records),
        reconciled_transactions=[r.transaction_id for r in records],
    )


@router.post("/{session_id}/reconcile", response_model=SessionResponse)
def reconcile_session(
    session_id: str,
    max_age_seconds: int = 300,
    shield: AgentShield = Depends(get_shield),
) -> SessionResponse:
    """Reconcile stale reservations and return updated session status."""
    if (
        hasattr(shield.policy_provider, "has_session")
        and not shield.policy_provider.has_session(session_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    shield.reconcile_stale_reservations(max_age_seconds=max_age_seconds)
    policy = shield.policy_provider.get_policy(session_id)
    intent = shield.intent_provider.get_intent(session_id)
    return SessionResponse(
        session_id=session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        intent=_to_intent_schema(intent),
        committed_spend=shield.get_committed_spend(session_id),
        reserved_spend=shield.get_reserved_spend(session_id),
        total_active_spend=shield.get_session_spend(session_id),
    )
