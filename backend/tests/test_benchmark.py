"""Tests for Track 02 AI Risk Manager benchmark dataset, evaluator, and endpoints."""

from fastapi.testclient import TestClient
from app.benchmark.dataset import get_benchmark_dataset
from app.benchmark.evaluator import evaluate_benchmark
from app.main import app


def test_benchmark_dataset_integrity():
    """Verify dataset contains 120+ cases with balanced vectors and valid schemas."""
    cases = get_benchmark_dataset()
    assert len(cases) >= 120

    benign = [c for c in cases if not c.is_adversarial]
    adversarial = [c for c in cases if c.is_adversarial]

    assert len(benign) == 50
    assert len(adversarial) >= 70

    # Ensure all expected risk vectors exist
    vectors = {c.risk_vector for c in cases}
    assert "BENIGN_LEGITIMATE" in vectors
    assert "SEMANTIC_CATEGORY_MISMATCH" in vectors
    assert "INDIRECT_PROMPT_INJECTION" in vectors
    assert "AGGREGATE_SPEND_OVERFLOW" in vectors
    assert "VELOCITY_BURST_ATTACK" in vectors
    assert "TOOL_PRIVILEGE_ESCALATION" in vectors
    assert "AMOUNT_OVER_POLICY" in vectors


def test_benchmark_evaluator_metrics_calculation():
    """Verify evaluator produces valid precision, recall, confusion matrix, and financial ROI."""
    report = evaluate_benchmark()

    assert report.total_cases >= 120
    assert report.true_positives + report.false_negatives == report.adversarial_cases
    assert report.true_negatives + report.false_positives == report.benign_cases

    # High precision and recall on held-out suite
    assert report.precision >= 0.95
    assert report.recall >= 0.95
    assert report.f1_score >= 0.95
    assert report.accuracy >= 0.95

    # Financial ledger validation
    assert report.total_loss_prevented_inr > 0
    assert report.net_financial_roi_inr > 0
    assert report.total_loss_prevented_inr >= report.net_financial_roi_inr

    # Vector breakdown validation
    assert len(report.vector_breakdown) >= 6
    for vb in report.vector_breakdown:
        assert vb.total_samples > 0
        assert 0.0 <= vb.accuracy <= 1.0


def test_benchmark_api_endpoints():
    """Verify GET /api/v1/benchmark/summary and POST /api/v1/benchmark/run return valid reports."""
    client = TestClient(app)

    # 1. Summary endpoint
    res_summary = client.get("/api/v1/benchmark/summary")
    assert res_summary.status_code == 200
    data = res_summary.json()
    assert "precision" in data
    assert "recall" in data
    assert "f1_score" in data
    assert "true_positives" in data
    assert "vector_breakdown" in data

    # 2. Live run endpoint
    res_run = client.post("/api/v1/benchmark/run")
    assert res_run.status_code == 200
    data_run = res_run.json()
    assert data_run["total_cases"] >= 120
    assert data_run["net_financial_roi_inr"] > 0
