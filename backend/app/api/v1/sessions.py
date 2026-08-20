"""API router for session lifecycle management."""

from fastapi import APIRouter, HTTPException, status

from app.agentshield.policy_engine import Policy
from app.agentshield.policy_provider import InMemoryPolicyProvider
from app.api.v1.tools import _policy_provider, _shield
from app.schemas.session import (
    CreateSessionRequest,
    PolicySchema,
    SessionResponse,
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
    )


def _to_policy(schema: PolicySchema) -> Policy:
    return Policy(
        allowed_tools=frozenset(schema.allowed_tools),
        max_transaction_amount=schema.max_transaction_amount,
        max_session_spend=schema.max_session_spend,
    )


@router.post(
    "",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_session(request: CreateSessionRequest) -> SessionResponse:
    """Create a new session with an optional policy."""
    if isinstance(_policy_provider, InMemoryPolicyProvider):
        if _policy_provider.has_session(request.session_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Session '{request.session_id}' already exists",
            )
        policy = (
            _to_policy(request.policy)
            if request.policy is not None
            else Policy()
        )
        _policy_provider.set_policy(request.session_id, policy)

    policy = _policy_provider.get_policy(request.session_id)
    return SessionResponse(
        session_id=request.session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        committed_spend=_shield.get_committed_spend(request.session_id),
        reserved_spend=_shield.get_reserved_spend(request.session_id),
        total_active_spend=_shield.get_session_spend(request.session_id),
    )


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: str) -> SessionResponse:
    """Retrieve session details, active policy, and spend metrics."""
    if (
        isinstance(_policy_provider, InMemoryPolicyProvider)
        and not _policy_provider.has_session(session_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    policy = _policy_provider.get_policy(session_id)
    return SessionResponse(
        session_id=session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        committed_spend=_shield.get_committed_spend(session_id),
        reserved_spend=_shield.get_reserved_spend(session_id),
        total_active_spend=_shield.get_session_spend(session_id),
    )


@router.put("/{session_id}/policy", response_model=SessionResponse)
def set_session_policy(
    session_id: str, request: SetSessionPolicyRequest
) -> SessionResponse:
    """Register or update a policy for a session."""
    policy = _to_policy(request.policy)
    if isinstance(_policy_provider, InMemoryPolicyProvider):
        _policy_provider.set_policy(session_id, policy)

    return SessionResponse(
        session_id=session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        committed_spend=_shield.get_committed_spend(session_id),
        reserved_spend=_shield.get_reserved_spend(session_id),
        total_active_spend=_shield.get_session_spend(session_id),
    )


@router.post("/{session_id}/reset", response_model=SessionResponse)
def reset_session_spend(session_id: str) -> SessionResponse:
    """Reset the cumulative spend metrics for a session."""
    if (
        isinstance(_policy_provider, InMemoryPolicyProvider)
        and not _policy_provider.has_session(session_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    _shield.reset_session_spend(session_id)
    policy = _policy_provider.get_policy(session_id)
    return SessionResponse(
        session_id=session_id,
        status="ACTIVE",
        policy=_to_policy_schema(policy),
        committed_spend=0,
        reserved_spend=0,
        total_active_spend=0,
    )


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str) -> None:
    """Delete a session policy and clear tracked spend."""
    if (
        isinstance(_policy_provider, InMemoryPolicyProvider)
        and not _policy_provider.has_session(session_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found",
        )

    if isinstance(_policy_provider, InMemoryPolicyProvider):
        _policy_provider.remove_policy(session_id)
    _shield.reset_session_spend(session_id)
