from app.agentshield.intent import IntentValidationResult
from app.agentshield.policy_engine import PolicyViolation
from app.agentshield.risk_engine import evaluate_risk


def test_clean_request_has_low_risk() -> None:
    result = evaluate_risk()

    assert result.risk_score == 0.0
    assert result.risk_level == "LOW"
    assert result.reasons == []


def test_policy_violation_is_critical() -> None:
    result = evaluate_risk(
        policy_violations=[
            PolicyViolation(
                rule="MAX_TRANSACTION_AMOUNT",
                actual=6000,
                limit=5000,
            )
        ]
    )

    assert result.risk_score == 1.0
    assert result.risk_level == "CRITICAL"
    assert result.reasons == ["MAX_TRANSACTION_AMOUNT"]


def test_intent_mismatch_is_critical_and_deduplicated() -> None:
    validation = IntentValidationResult(
        intent_match=False,
        category_match=False,
        reasons=["INTENT_CATEGORY_MISMATCH", "INTENT_CATEGORY_MISMATCH"],
    )

    result = evaluate_risk(intent_validation=validation)

    assert result.risk_score == 0.95
    assert result.risk_level == "CRITICAL"
    assert result.reasons == ["INTENT_CATEGORY_MISMATCH"]


def test_low_semantic_confidence_is_high_risk() -> None:
    validation = IntentValidationResult(
        intent_match=True,
        confidence=0.65,
    )

    result = evaluate_risk(semantic_validation=validation)

    assert result.risk_score == 0.7
    assert result.risk_level == "HIGH"
    assert result.reasons == ["SEMANTIC_LOW_CONFIDENCE"]


def test_additional_signals_are_explained() -> None:
    result = evaluate_risk(
        additional_reasons=["VELOCITY_THRESHOLD_EXCEEDED", "VELOCITY_THRESHOLD_EXCEEDED"]
    )

    assert result.risk_score == 0.6
    assert result.risk_level == "MEDIUM"
    assert result.reasons == ["VELOCITY_THRESHOLD_EXCEEDED"]
