"""End-to-end agent integration and tool execution endpoints."""

from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.agent.controller import AgentController, AgentControllerError
from app.agentshield.executor import AgentShield
from app.api.deps import get_shield
from app.schemas.agent import (
    AgentRunRequest,
    AgentRunResponse,
    AgentToolProposal,
)
from app.schemas.tool_execution import ExecuteToolRequest, ExecuteToolResponse

router = APIRouter(prefix="/agent", tags=["agent"])


class ExternalAgentExecuteRequest(BaseModel):
    """Payload sent by any external AI agent seeking authorization and execution."""

    session_id: str = Field(description="Session identifier tracking spend and policy")
    tool_name: str = Field(description="Name of the sensitive tool requested (e.g. create_order)")
    arguments: dict[str, Any] = Field(description="Tool arguments (e.g. amount, currency, category, purpose)")
    agent_id: str | None = Field(default=None, description="Optional external agent identifier")
    metadata: dict[str, Any] | None = Field(default=None, description="Optional context or traces")


@router.post("/run", response_model=AgentRunResponse)
def run_agent(
    request: AgentRunRequest,
    shield: AgentShield = Depends(get_shield),
) -> AgentRunResponse:
    """Run one untrusted LLM proposal through the complete security boundary."""
    if shield.llm_provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="NVIDIA NIM is not configured. Set NVIDIA_API_KEY in backend/.env.",
        )

    controller = AgentController(shield.llm_provider)
    try:
        intent, proposal, result = controller.run(
            shield=shield,
            session_id=request.session_id,
            user_prompt=request.user_prompt,
        )
    except AgentControllerError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    execution = ExecuteToolResponse(
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
    return AgentRunResponse(
        llm_provider=shield.llm_provider.__class__.__name__,
        user_prompt=request.user_prompt,
        authorized_intent=intent,
        proposed_tool_call=AgentToolProposal.model_validate(proposal),
        decision=result.decision,
        execution=execution,
    )


@router.post("/execute", response_model=ExecuteToolResponse)
def execute_external_agent_tool(
    request: ExternalAgentExecuteRequest,
    shield: AgentShield = Depends(get_shield),
) -> ExecuteToolResponse:
    """Authorize and execute a tool call requested by ANY external autonomous AI agent."""
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
