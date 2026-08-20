"""API router for agent tool execution."""

from fastapi import APIRouter, Depends

from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy
from app.api.deps import get_shield
from app.schemas.tool_execution import ExecuteToolRequest, ExecuteToolResponse

router = APIRouter(prefix="/tools", tags=["tools"])

DEMO_POLICY = Policy(
    allowed_tools=frozenset({"create_order"}),
    max_transaction_amount=5000,
    max_session_spend=10000,
    require_approval_above=3000,
)


@router.post("/execute", response_model=ExecuteToolResponse)
def execute_tool(
    request: ExecuteToolRequest,
    shield: AgentShield = Depends(get_shield),
) -> ExecuteToolResponse:
    """Execute an agent tool request through AgentShield."""
    result = shield.execute_tool(
        session_id=request.session_id,
        tool_name=request.tool_name,
        arguments=request.arguments,
    )
    return ExecuteToolResponse(
        decision=result.decision,
        session_id=result.session_id,
        tool_name=result.tool_name,
        risk_score=result.risk_score,
        risk_level=result.risk_level,
        reasons=result.reasons,
        policy_violations=result.policy_violations,
        intent_validation=result.intent_validation,
        semantic_validation=result.semantic_validation,
        provider_result=result.provider_result,
        transaction_id=result.transaction_id,
        transaction_status=result.transaction_status,
        approval_id=result.approval_id,
        error=result.error,
    )
