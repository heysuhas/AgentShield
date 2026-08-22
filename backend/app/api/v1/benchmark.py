"""API endpoints for Track 02 AI Risk Manager benchmark evaluation."""

from fastapi import APIRouter
from app.benchmark.evaluator import BenchmarkReport, evaluate_benchmark

router = APIRouter(prefix="/benchmark", tags=["benchmark"])

# Cache pre-evaluated report on import for rapid initial loading
_CACHED_REPORT: BenchmarkReport | None = None


def get_or_create_cached_report() -> BenchmarkReport:
    global _CACHED_REPORT
    if _CACHED_REPORT is None:
        _CACHED_REPORT = evaluate_benchmark()
    return _CACHED_REPORT


@router.get("/summary", response_model=BenchmarkReport)
def get_benchmark_summary() -> BenchmarkReport:
    """Retrieve pre-evaluated benchmark metrics and financial impact scorecard."""
    return get_or_create_cached_report()


@router.post("/run", response_model=BenchmarkReport)
def run_live_benchmark() -> BenchmarkReport:
    """Re-execute the held-out benchmark suite live and return fresh evaluation metrics."""
    global _CACHED_REPORT
    _CACHED_REPORT = evaluate_benchmark()
    return _CACHED_REPORT
