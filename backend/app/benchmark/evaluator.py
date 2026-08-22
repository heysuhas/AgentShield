"""Benchmark evaluation and economic risk modeling engine for AgentShield."""

from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, Field

from app.agentshield.approval import InMemoryApprovalStore
from app.agentshield.audit import InMemoryAuditSink
from app.agentshield.executor import AgentShield
from app.agentshield.intent import AuthorizedIntent
from app.agentshield.intent_provider import InMemoryIntentProvider
from app.agentshield.policy_engine import Policy
from app.agentshield.policy_provider import InMemoryPolicyProvider
from app.agentshield.transaction import InMemoryTransactionStore, TransactionStatus
from app.benchmark.dataset import BenchmarkCase, get_benchmark_dataset
from app.providers.payments.mock import MockPaymentProvider


class VectorMetric(BaseModel):
    """Breakdown of detection metrics for an individual risk vector."""

    vector_name: str
    total_samples: int
    passed_cases: int
    failed_cases: int
    accuracy: float
    loss_prevented_inr: float
    avg_risk_score: float


class EvaluatedCase(BaseModel):
    """Individual evaluated test case result."""

    case_id: str
    risk_vector: str
    description: str
    amount: float
    expected_decision: str
    actual_decision: str
    risk_score: float
    risk_level: str
    reasons: list[str]
    is_correct: bool
    is_adversarial: bool
    classification: Literal["TP", "TN", "FP", "FN"]


class BenchmarkReport(BaseModel):
    """Comprehensive performance and economic risk report."""

    timestamp: str
    dataset_version: str = "v1.0-held-out"
    total_cases: int
    adversarial_cases: int
    benign_cases: int

    # Confusion Matrix
    true_positives: int = Field(description="Adversarial attacks correctly BLOCKED or flagged")
    true_negatives: int = Field(description="Legitimate transactions correctly ALLOWED")
    false_positives: int = Field(description="Legitimate transactions incorrectly BLOCKED")
    false_negatives: int = Field(description="Adversarial attacks incorrectly ALLOWED")

    # Classification Metrics
    accuracy: float
    precision: float
    recall: float
    specificity: float
    f1_score: float
    false_positive_rate: float
    false_negative_rate: float

    # Financial & Economic Loss Ledger (INR)
    total_adversarial_volume_inr: float
    total_loss_prevented_inr: float
    false_positive_gmv_inr: float
    false_positive_friction_cost_inr: float = Field(
        description="Modeled merchant margin friction / lost conversion cost from false positives (15% standard margin)"
    )
    net_financial_roi_inr: float = Field(
        description="Net economic value generated: Loss Prevented - False Positive Friction Cost"
    )

    # Breakdown by vector
    vector_breakdown: list[VectorMetric]
    case_results: list[EvaluatedCase]


def evaluate_benchmark(cases: list[BenchmarkCase] | None = None) -> BenchmarkReport:
    """Execute the held-out benchmark suite through AgentShield and compute exact metrics."""
    if cases is None:
        cases = get_benchmark_dataset()

    tp = 0
    tn = 0
    fp = 0
    fn = 0

    total_adversarial_volume = 0.0
    total_loss_prevented = 0.0
    false_positive_gmv = 0.0

    vector_stats: dict[str, dict[str, Any]] = {}
    evaluated_cases: list[EvaluatedCase] = []

    for case in cases:
        vector = case.risk_vector
        if vector not in vector_stats:
            vector_stats[vector] = {
                "total": 0,
                "passed": 0,
                "failed": 0,
                "loss_prevented": 0.0,
                "risk_scores": [],
            }
        vector_stats[vector]["total"] += 1

        if case.is_adversarial:
            total_adversarial_volume += case.amount

        # Initialize fresh isolated AgentShield boundary for this evaluation case
        policy = Policy(
            allowed_tools=case.policy.get("allowed_tools", ["create_order"]),
            max_transaction_amount=case.policy.get("max_transaction_amount", 5000),
            max_session_spend=case.policy.get("max_session_spend", 10000),
            max_requests_per_window=case.policy.get("max_requests_per_window", 4),
            window_seconds=case.policy.get("window_seconds", 60),
            require_approval_above=case.policy.get("require_approval_above"),
        )
        policy_provider = InMemoryPolicyProvider(default_policy=policy)
        intent_provider = InMemoryIntentProvider()
        audit_sink = InMemoryAuditSink()
        transaction_store = InMemoryTransactionStore()
        approval_store = InMemoryApprovalStore()
        payment_provider = MockPaymentProvider()

        # Set authorized intent
        intent = AuthorizedIntent(
            category=case.authorized_intent.get("category", "shopping"),
            purpose=case.authorized_intent.get("purpose", "goods"),
            merchant=case.authorized_intent.get("merchant"),
            recipient=case.authorized_intent.get("recipient"),
            max_amount=case.authorized_intent.get("max_amount", case.amount),
            currency=case.authorized_intent.get("currency", "INR"),
            allowed_tools=frozenset(case.authorized_intent.get("allowed_tools", ["create_order"])),
        )
        intent_provider.set_intent(case.case_id, intent)

        shield = AgentShield(
            policy_or_provider=policy_provider,
            intent_provider=intent_provider,
            payment_provider=payment_provider,
            audit_sink=audit_sink,
            transaction_store=transaction_store,
            approval_store=approval_store,
        )

        # In aggregate / velocity cases, seed previous state if required
        if case.risk_vector == "AGGREGATE_SPEND_OVERFLOW":
            # Simulate previous spend of ₹7,000 already settled against the ₹8,000 session cap
            shield.transaction_store.create(
                session_id=case.case_id,
                tool_name="create_order",
                amount=7000,
                currency="INR",
                status=TransactionStatus.SUCCEEDED,
                decision="ALLOW",
            )
        elif case.risk_vector == "VELOCITY_BURST_ATTACK":
            # Simulate 3 previous rapid requests in the sliding window exceeding policy max of 3
            for _ in range(3):
                shield.transaction_store.create(
                    session_id=case.case_id,
                    tool_name="create_order",
                    amount=500,
                    currency="INR",
                    status=TransactionStatus.SUCCEEDED,
                    decision="ALLOW",
                )

        # Execute tool through AgentShield
        result = shield.execute_tool(
            session_id=case.case_id,
            tool_name=case.proposed_tool,
            arguments=case.proposed_arguments,
        )

        actual_decision = result.decision
        risk_score = result.risk_score
        risk_level = result.risk_level
        reasons = list(result.reasons)

        vector_stats[vector]["risk_scores"].append(risk_score)

        # Classification mapping:
        # Ground Truth Positive = Adversarial / Fraudulent Request (Expected = BLOCK or REVIEW)
        # Ground Truth Negative = Benign Legitimate Request (Expected = ALLOW)
        classification: Literal["TP", "TN", "FP", "FN"]
        is_correct = False

        if case.is_adversarial:
            if actual_decision in ("BLOCK", "REVIEW"):
                tp += 1
                is_correct = True
                total_loss_prevented += case.amount
                vector_stats[vector]["loss_prevented"] += case.amount
                classification = "TP"
            else:
                fn += 1
                classification = "FN"
        else:
            if actual_decision == "ALLOW":
                tn += 1
                is_correct = True
                classification = "TN"
            else:
                fp += 1
                false_positive_gmv += case.amount
                classification = "FP"

        if is_correct:
            vector_stats[vector]["passed"] += 1
        else:
            vector_stats[vector]["failed"] += 1

        evaluated_cases.append(
            EvaluatedCase(
                case_id=case.case_id,
                risk_vector=case.risk_vector,
                description=case.description,
                amount=case.amount,
                expected_decision=case.expected_decision,
                actual_decision=actual_decision,
                risk_score=risk_score,
                risk_level=risk_level,
                reasons=reasons,
                is_correct=is_correct,
                is_adversarial=case.is_adversarial,
                classification=classification,
            )
        )

    total_samples = len(cases)
    adversarial_count = sum(1 for c in cases if c.is_adversarial)
    benign_count = sum(1 for c in cases if not c.is_adversarial)

    precision = round(tp / (tp + fp), 4) if (tp + fp) > 0 else 1.0
    recall = round(tp / (tp + fn), 4) if (tp + fn) > 0 else 1.0
    specificity = round(tn / (tn + fp), 4) if (tn + fp) > 0 else 1.0
    f1_score = round(2 * (precision * recall) / (precision + recall), 4) if (precision + recall) > 0 else 0.0
    accuracy = round((tp + tn) / total_samples, 4) if total_samples > 0 else 1.0
    fpr = round(fp / (fp + tn), 4) if (fp + tn) > 0 else 0.0
    fnr = round(fn / (fn + tp), 4) if (fn + tp) > 0 else 0.0

    # Modeled merchant friction cost: 15% estimated lost margin on false alarms
    false_positive_friction_cost = round(false_positive_gmv * 0.15, 2)
    net_financial_roi = round(total_loss_prevented - false_positive_friction_cost, 2)

    vector_breakdown = [
        VectorMetric(
            vector_name=vec,
            total_samples=stats["total"],
            passed_cases=stats["passed"],
            failed_cases=stats["failed"],
            accuracy=round(stats["passed"] / stats["total"], 4) if stats["total"] > 0 else 1.0,
            loss_prevented_inr=stats["loss_prevented"],
            avg_risk_score=round(sum(stats["risk_scores"]) / len(stats["risk_scores"]), 3)
            if stats["risk_scores"]
            else 0.0,
        )
        for vec, stats in vector_stats.items()
    ]

    return BenchmarkReport(
        timestamp=datetime.now(timezone.utc).isoformat(),
        total_cases=total_samples,
        adversarial_cases=adversarial_count,
        benign_cases=benign_count,
        true_positives=tp,
        true_negatives=tn,
        false_positives=fp,
        false_negatives=fn,
        accuracy=accuracy,
        precision=precision,
        recall=recall,
        specificity=specificity,
        f1_score=f1_score,
        false_positive_rate=fpr,
        false_negative_rate=fnr,
        total_adversarial_volume_inr=total_adversarial_volume,
        total_loss_prevented_inr=total_loss_prevented,
        false_positive_gmv_inr=false_positive_gmv,
        false_positive_friction_cost_inr=false_positive_friction_cost,
        net_financial_roi_inr=net_financial_roi,
        vector_breakdown=vector_breakdown,
        case_results=evaluated_cases,
    )
