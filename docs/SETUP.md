# AgentShield Setup & Verification Guide

This guide covers local development, testing, and Docker Compose deployment for AgentShield.

---

## 1. Prerequisites

- **Python**: 3.12+ (or 3.14+) with [`uv`](https://docs.astral.sh/uv/) installed.
- **Node.js**: 20+ with `npm`.
- **Docker & Docker Compose**: Optional for containerized deployment.
- **NVIDIA NIM API Key**: Required for live LLM semantic intent evaluation.
- **Razorpay Sandbox Credentials**: Optional for live sandbox payment testing.

---

## 2. Quickstart with Docker Compose

To spin up the complete multi-container stack (Backend + Frontend + PostgreSQL):

```bash
# 1. Clone repository
git clone https://github.com/heysuhas/AgentShield.git
cd AgentShield

# 2. Configure environment
cp .env.example .env
# Edit .env with your NVIDIA_API_KEY and RAZORPAY test credentials

# 3. Launch stack
docker compose up --build
```

- **Frontend Dashboard**: `http://localhost:3000`
- **Backend API Docs**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/health`

---

## 3. Local Development Setup

### Backend (FastAPI + SQLAlchemy)

```bash
cd backend

# 1. Sync dependencies
uv sync

# 2. Configure environment
cp ../.env.example .env

# 3. Run database migrations
uv run alembic upgrade head

# 4. Start API server
uv run uvicorn app.main:app --reload --port 8000
```

### Frontend (React + TypeScript + Vite)

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Start Vite dev server
npm run dev
```

The frontend will run at `http://localhost:5173` and proxy API calls to `http://localhost:8000`.

---

## 4. Running the Test Suite

AgentShield maintains a deterministic test suite covering unit, integration, concurrency, and benchmark tests:

```bash
cd backend
uv run pytest -v
```

Expected output:
```text
============================= 115 passed in ~2.0s ==============================
```

To build and verify the frontend bundle:

```bash
cd frontend
npm run build
```

---

## 5. Running the Risk Benchmark Suite

To run the formal 130-scenario held-out evaluation suite from the CLI:

```bash
cd backend
uv run python -c "from app.benchmark.evaluator import evaluate_benchmark; report = evaluate_benchmark(); print(f'Total: {report.total_cases}, Precision: {report.precision:.1%}, Recall: {report.recall:.1%}, F1: {report.f1_score:.3f}, Loss Prevented: INR {report.total_loss_prevented_inr:,.0f}')"
```
