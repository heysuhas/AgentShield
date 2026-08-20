"""API router for agent tool execution."""

from fastapi import APIRouter

from app.agentshield.executor import AgentShield
from app.agentshield.policy_engine import Policy
from app.agentshield.policy_provider import InMemoryPolicyProvider
from app.providers.payments.mock import MockPaymentProvider
from app.schemas.tool_execution import ExecuteToolRequest, ExecuteToolResponse

router = APIRouter(prefix="/tools", tags=["tools"])

DEMO_POLICY = Policy(
    allowed_tools=frozenset({"create_order"}),
    max_transaction_amount=5000,
    max_session_spend=10000,
)
_policy_provider = InMemoryPolicyProvider(
    policies={"session_123": DEMO_POLICY}
)
_payment_provider = MockPaymentProvider()
_shield = AgentShield(
    policy_or_provider=_policy_provider,
    payment_provider=_payment_provider,
)


@router.post("/execute", response_model=ExecuteToolResponse)
def execute_tool(request: ExecuteToolRequest) -> ExecuteToolResponse:
    """Execute an agent tool request through AgentShield."""
    result = _shield.execute_tool(
        session_id=request.session_id,
        tool_name=request.tool_name,
        arguments=request.arguments,
    )
    return ExecuteToolResponse(
        decision=result.decision,
        session_id=result.session_id,
        tool_name=result.tool_name,
        risk_score=result.risk_score,
        reasons=result.reasons,
        policy_violations=result.policy_violations,
        provider_result=result.provider_result,
        transaction_id=result.transaction_id,
        transaction_status=result.transaction_status,
    )
