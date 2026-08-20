"""Deterministic policy checks for requested agent tool calls."""

from pydantic import BaseModel, ConfigDict, Field


class Policy(BaseModel):
    """The hard limits and permissions applied to an agent request."""

    model_config = ConfigDict(frozen=True)

    allowed_tools: frozenset[str] = Field(default_factory=frozenset)
    max_transaction_amount: int | None = Field(default=None, ge=0)
    max_session_spend: int | None = Field(default=None, ge=0)
    max_requests_per_window: int | None = Field(default=None, ge=1)
    window_seconds: int = Field(default=60, ge=1)
    max_spend_per_window: int | None = Field(default=None, ge=0)
    require_approval_above: int | None = Field(default=None, ge=0)
    require_human_approval: bool = Field(default=False)


class PolicyViolation(BaseModel):
    """A machine-readable explanation for one failed policy rule."""

    rule: str
    actual: int | str
    limit: int | str | None = None


class PolicyDecision(BaseModel):
    """The result of applying a policy without invoking an LLM or provider."""

    allowed: bool
    violations: list[PolicyViolation] = Field(default_factory=list)


def evaluate_policy(
    policy: Policy,
    *,
    tool_name: str,
    amount: int | None = None,
    current_session_spend: int = 0,
) -> PolicyDecision:
    """Evaluate hard tool and transaction rules for a requested action."""

    violations: list[PolicyViolation] = []

    if tool_name not in policy.allowed_tools:
        violations.append(
            PolicyViolation(
                rule="TOOL_NOT_ALLOWED",
                actual=tool_name,
                limit="allowed_tools",
            )
        )

    if (
        amount is not None
        and policy.max_transaction_amount is not None
        and amount > policy.max_transaction_amount
    ):
        violations.append(
            PolicyViolation(
                rule="MAX_TRANSACTION_AMOUNT",
                actual=amount,
                limit=policy.max_transaction_amount,
            )
        )

    if (
        amount is not None
        and policy.max_session_spend is not None
        and (current_session_spend + amount) > policy.max_session_spend
    ):
        violations.append(
            PolicyViolation(
                rule="MAX_SESSION_SPEND",
                actual=current_session_spend + amount,
                limit=policy.max_session_spend,
            )
        )

    return PolicyDecision(allowed=not violations, violations=violations)
