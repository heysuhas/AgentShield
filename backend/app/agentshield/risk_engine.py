"""Interpretable, deterministic risk scoring for AgentShield decisions."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.agentshield.intent import IntentValidationResult
from app.agentshield.policy_engine import PolicyViolation


RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


class RiskResult(BaseModel):
    """Explainable risk evidence; this does not authorize a tool call."""

    model_config = ConfigDict(frozen=True)

    risk_score: float = Field(ge=0.0, le=1.0)
    risk_level: RiskLevel
    reasons: list[str] = Field(default_factory=list)


def evaluate_risk(
    *,
    policy_violations: list[PolicyViolation] | None = None,
    intent_validation: IntentValidationResult | None = None,
    semantic_validation: IntentValidationResult | None = None,
    additional_reasons: list[str] | None = None,
) -> RiskResult:
    """Calculate deterministic risk evidence from enforcement signals.

    The highest-severity signal wins. Callers must still use policy and intent
    rules for the final ALLOW/BLOCK decision; a score is never authorization.
    """

    reasons: list[str] = []
    score = 0.0

    for violation in policy_violations or []:
        reasons.append(violation.rule)
        score = max(score, 1.0)

    if intent_validation is not None and not intent_validation.intent_match:
        reasons.extend(intent_validation.reasons)
        score = max(score, 0.95)

    if semantic_validation is not None:
        if not semantic_validation.intent_match:
            reasons.extend(semantic_validation.reasons)
            score = max(score, 0.9)
        elif semantic_validation.confidence < 0.7:
            reasons.append("SEMANTIC_LOW_CONFIDENCE")
            score = max(score, 0.7)

    for reason in additional_reasons or []:
        reasons.append(reason)
        score = max(score, 0.6)

    unique_reasons = list(dict.fromkeys(reasons))
    if score >= 0.95:
        level: RiskLevel = "CRITICAL"
    elif score >= 0.7:
        level = "HIGH"
    elif score > 0.0:
        level = "MEDIUM"
    else:
        level = "LOW"

    return RiskResult(
        risk_score=score,
        risk_level=level,
        reasons=unique_reasons,
    )
