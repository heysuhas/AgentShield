# AgentShield — The Trust Layer Between AI and Money

[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-1.0.0-009688.svg)](https://fastapi.tiangolo.com)
[![Razorpay Sandbox](https://img.shields.io/badge/Razorpay-Sandbox_Ready-006fee.svg)](https://razorpay.com)
[![NVIDIA NIM](https://img.shields.io/badge/NVIDIA-NIM_Inference-76b900.svg)](https://build.nvidia.com)
[![Tests](https://img.shields.io/badge/tests-115%20passed-brightgreen.svg)]()

> **AgentShield** is a standalone, pluggable authorization and risk kernel positioned between autonomous AI agents and payment infrastructure.

---

## Empirical Risk & Security Benchmark

AgentShield includes a formal empirical benchmark and evaluation suite modeling autonomous agent attacks, semantic intent hijacking, and legitimate e-commerce traffic:

> *AgentShield’s deterministic enforcement suite evaluated 130 curated scenarios with 100% detection on this fixture: 50 legitimate requests allowed and 80 adversarial structured requests blocked or escalated.*

| Metric | Empirical Score | Description |
|---|:---:|---|
| **Curated Scenarios** | **130** | 50 benign legitimate e-commerce checkouts + 80 adversarial structured attacks across 7 operational risk vectors |
| **Precision (PPV)** | **100.0%** | $\frac{TP}{TP + FP} = \frac{80}{80 + 0}$ — Zero false alarms or wrongful blocks on legitimate user purchases |
| **Recall / Sensitivity** | **100.0%** | $\frac{TP}{TP + FN} = \frac{80}{80 + 0}$ — Complete interception of unauthorized attacks, injections, and budget overflows |
| **F1 Score** | **1.000** | Harmonic mean accuracy across the held-out evaluation fixture |
| **Loss Prevented** | **₹9,80,533** | Total unauthorized and fraudulent financial volume neutralized before hitting payment rails |
| **False-Positive Friction** | **₹0** | Modeled 15% merchant gross margin loss from false rejections |

---

## The Core Invariant

```text
The agent may request an action. The agent never authorizes its own action.
```

When an autonomous AI agent decides to execute a financial transaction (e.g. creating a purchase order, issuing a payout, or generating a payment link), **it is an untrusted request, not an authorization**.

AgentShield evaluates the request across deterministic policies, semantic intent constraints, aggregate budgets, velocity windows, and human approval gates before anything touches payment rails.

---

## Architecture & Pluggability

AgentShield is a **service**. The backend is the product; the included frontend dashboard is a reference interface demonstrating and operating the service.

```text
Any External AI Agent (LangChain / CrewAI / AutoGen / Custom)
    │
    │ POST /api/v1/agent/execute
    ▼
┌────────────────────────────────────────────────────────┐
│               AgentShield Security Kernel              │
│                                                        │
│  1. Tool Permissions        (create_order vs payout)   │
│  2. Deterministic Policies  (amount, session cap)      │
│  3. Sliding Velocity Engine (requests / burst spend)   │
│  4. Semantic Intent Guard   (NVIDIA NIM Llama 3.1)     │
│  5. Human Approval Gate     (PENDING state hold)       │
│  6. Atomic Spend Ledger     (reserved vs committed)    │
│  7. Tamper-Evident Audit    (immutable event log)      │
└──────────────────────────┬─────────────────────────────┘
                           │ ALLOW / APPROVED
                           ▼
                  PaymentProvider Abstraction
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
    RazorpaySandboxProvider      MockPaymentProvider
     (Paise Subunit Conversion)   (Deterministic Local Tests)
             │
             ▼
    Razorpay Sandbox APIs
```

> 📖 **Looking to integrate your own AI agent?** Read the comprehensive [Developer & Integration Guide](docs/INTEGRATION_GUIDE.md) for detailed patterns, LangChain tool wrappers, and protocol extensions.

---

## Key Capabilities

1. **Pluggable Multi-Agent Integration**: Any external agent framework can plug directly into AgentShield via standard REST APIs (`/api/v1/agent/execute` or `/api/v1/tools/execute`).
2. **Deterministic Enforcement First**: Hard security rules (amount limits, tool permissions, aggregate session budgets, rate limits) are enforced deterministically in Python/PostgreSQL. The LLM is untrusted and used only for semantic comparison evidence.
3. **Semantic Intent Validation**: Powered by NVIDIA NIM (`meta/llama-3.1-8b-instruct`), AgentShield compares user-authorized intent against tool arguments to defeat prompt injections (e.g., user asks for "running shoes under ₹5,000", malicious prompt attempts to buy a ₹4,999 gift card $\rightarrow$ **BLOCKED**).
4. **Human-in-the-Loop Review Gates**: Transactions exceeding high-value thresholds are placed in `PENDING` status with atomic spend reservations. Payment rails are never called until an operator explicitly approves.
5. **Razorpay Sandbox Rails & Standard Checkout**: Native integration with Razorpay's test environment with automatic subunit conversion (INR $\leftrightarrow$ paise), idempotent order creation, and HMAC-SHA256 signature verification.
6. **Sliding-Window Velocity & Burst Defense**: Sliding-window rate limiters prevent runaway loops and rapid drain attacks.
7. **Tamper-Evident Audit Logging**: Every evaluation, allow, block, and review decision is immutably logged with structured risk signals.

---

## Quickstart

### Option A: Run with Docker Compose (Recommended)

Clone the repository and spin up the complete multi-container stack (Backend + Frontend + PostgreSQL):

```bash
# 1. Clone and enter repo
git clone https://github.com/heysuhas/AgentShield.git
cd AgentShield

# 2. Configure environment
cp .env.example .env
# Edit .env with your NVIDIA_API_KEY and RAZORPAY test credentials

# 3. Launch stack
docker compose up --build
```

- **Frontend Console**: `http://localhost:3000`
- **Backend API Docs**: `http://localhost:8000/docs`
- **Health Check**: `http://localhost:8000/health`

---

### Option B: Local Development

#### Backend (Python 3.12+)

```bash
cd backend

# Install dependencies using uv
uv sync

# Configure environment
cp ../.env.example .env

# Run database migrations
uv run alembic upgrade head

# Start API server
uv run uvicorn app.main:app --reload --port 8000
```

#### Frontend (Node.js 20+)

```bash
cd frontend
npm install
npm run dev
```

---

## Integrating Your AI Agent

Any AI agent can route financial operations through AgentShield in 3 lines of code:

### Python (`requests`)

```python
import requests

response = requests.post(
    "http://localhost:8000/api/v1/agent/execute",
    json={
        "session_id": "shopper_session_01",
        "tool_name": "create_order",
        "arguments": {
            "amount": 2999,
            "currency": "INR",
            "category": "footwear",
            "purpose": "running shoes"
        },
        "agent_id": "autonomous_procurement_agent"
    }
)

result = response.json()
if result["decision"] == "ALLOW":
    print("Order Created on Razorpay:", result["provider_result"]["order"]["id"])
elif result["decision"] == "REVIEW":
    print("Held for Operator Approval:", result["approval_id"])
else:
    print("Blocked by AgentShield:", result["reasons"])
```

### LangChain Custom Tool

```python
from langchain.tools import tool
import requests

@tool
def agentshield_create_order(amount: int, category: str, purpose: str) -> dict:
    """Create a purchase order securely through AgentShield financial firewall."""
    res = requests.post(
        "http://localhost:8000/api/v1/agent/execute",
        json={
            "session_id": "session_live",
            "tool_name": "create_order",
            "arguments": {"amount": amount, "category": category, "purpose": purpose}
        }
    )
    return res.json()
```

### cURL

```bash
curl -X POST http://localhost:8000/api/v1/agent/execute \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "shopper_session_01",
    "tool_name": "create_order",
    "arguments": {
      "amount": 2999,
      "currency": "INR",
      "category": "footwear",
      "purpose": "running shoes"
    }
  }'
```

For full TypeScript, Go, and webhook lifecycle examples, see the [Developer & Integration Guide](docs/INTEGRATION_GUIDE.md).

---

## API Reference Summary

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/agent/execute` | Authorize and execute a tool call requested by any external AI agent |
| `POST` | `/api/v1/agent/run` | Intercept and run untrusted LLM prompt through full AgentShield pipeline |
| `POST` | `/api/v1/tools/execute` | Direct tool execution through internal security kernel |
| `GET` | `/api/v1/payments/config` | Fetch public Razorpay checkout configuration |
| `POST` | `/api/v1/payments/verify` | Verify Razorpay HMAC SHA256 signature and settle transaction |
| `GET` | `/api/v1/sessions/{id}` | Inspect active session spend, policy, and intent |
| `POST` | `/api/v1/sessions` | Create or configure a session with spending caps |
| `GET` | `/api/v1/approvals` | List pending human-in-the-loop authorization requests |
| `POST` | `/api/v1/approvals/{id}/approve` | Human operator authorization and execution |
| `POST` | `/api/v1/approvals/{id}/reject` | Human operator rejection and cancellation |
| `GET` | `/api/v1/audit` | Query immutable audit ledger with structured risk reasons |
| `GET` | `/api/v1/transactions` | Query transaction records and statuses |
| `GET` | `/health` | Live service health, provider, and model telemetry |

---

## Running Tests

AgentShield maintains a comprehensive, deterministic test suite:

```bash
cd backend
uv run pytest -v
```

```text
======================== 115 passed, 1 warning in 1.81s ========================
```

---

## Documentation

- [Developer & Integration Guide](docs/INTEGRATION_GUIDE.md): Detailed integration patterns, LangChain wrappers, and lifecycle management.
- [Architecture Deep Dive](docs/ARCHITECTURE.md): Core component breakdown and threat model.
- [Setup Guide](docs/SETUP.md): Local development and Docker environment configuration.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
