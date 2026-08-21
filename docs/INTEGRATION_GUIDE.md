# AgentShield — Service Integration & Pluggability Guide

This guide details how to integrate AgentShield as a pluggable financial authorization and risk kernel into any external AI agent framework, backend infrastructure, or custom workflow.

---

## 1. Architectural Philosophy

AgentShield is a **service**. The backend is the product; any dashboard or frontend is simply one client of that service.

```text
  ┌────────────────────────────────────────────────────────┐
  │                 Your AI Agent System                   │
  │     (LangChain / AutoGen / CrewAI / Custom Agent)      │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             │ Tool Request: create_order(₹2,999)
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │              AgentShield Authorization Kernel          │
  │                                                        │
  │   1. Tool Permission Validation                        │
  │   2. Hard Deterministic Limits (Txn & Session Cap)     │
  │   3. Sliding-Window Velocity & Burst Controls          │
  │   4. Semantic Intent Matching (NVIDIA NIM Llama 3.1)   │
  │   5. Human-in-the-Loop Threshold Review Gate           │
  │   6. Atomic Spend Reservation Ledger                   │
  │   7. Tamper-Evident Immutable Audit Log                │
  └──────────────────────────┬─────────────────────────────┘
                             │
               ALLOW / APPROVED by Operator
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │             Payment Infrastructure Rails               │
  │           (Razorpay Sandbox / Live Gateway)            │
  └────────────────────────────────────────────────────────┘
```

---

## 2. What Makes AgentShield Different?

| Feature | Standard API Gateway (Kong / Cloudflare) | Payment Processor SDK (Razorpay / Stripe) | AgentShield Financial Kernel |
|---|---|---|---|
| **Semantic Intent Envelope** | ❌ None | ❌ None | ✅ Compares user prompt vs tool arguments via LLM |
| **Prompt Injection Defense** | ❌ Only static regex/WAF | ❌ None | ✅ Blocks semantic category/purpose deviations |
| **Atomic Spend Reservations**| ❌ None | ❌ None | ✅ Locks budget in `PENDING` during human review |
| **Human-in-the-Loop Review** | ❌ None | ❌ None | ✅ Built-in review queues for high-value orders |
| **Sliding-Window Velocity** | ⚠️ Basic IP Rate Limit | ⚠️ Account-level burst | ✅ Per-session sliding frequency & spend limits |
| **Audit Traceability** | ⚠️ HTTP Access Logs | ⚠️ Transaction Receipts | ✅ Full context: User Prompt + Proposal + Decision |

---

## 3. Integration Patterns

### Pattern A: Agent Tool Interceptor (Recommended)

In this pattern, your agent runs in your own environment. When your agent decides to call a sensitive payment tool (`create_order`, `refund_payment`, `create_payout`), you wrap that tool call so it delegates to AgentShield instead of calling payment APIs directly.

#### Python Example (Standard `requests`)

```python
import requests

AGENTSHIELD_URL = "http://localhost:8000/api/v1"

def safe_create_order(session_id: str, amount: int, category: str, purpose: str) -> dict:
    """Route agent order creation through AgentShield security kernel."""
    payload = {
        "session_id": session_id,
        "tool_name": "create_order",
        "arguments": {
            "amount": amount,
            "currency": "INR",
            "category": category,
            "purpose": purpose
        },
        "agent_id": "procurement_agent_v1"
    }

    response = requests.post(f"{AGENTSHIELD_URL}/agent/execute", json=payload)
    result = response.json()

    if result["decision"] == "ALLOW":
        order = result["provider_result"]["order"]
        return {"status": "SUCCESS", "order_id": order["id"], "amount": order["amount"]}
    elif result["decision"] == "REVIEW":
        return {"status": "PENDING_APPROVAL", "approval_id": result["approval_id"]}
    else:
        # Action blocked by policy or intent violation
        return {"status": "BLOCKED", "reasons": result["reasons"], "violations": result["policy_violations"]}
```

#### LangChain Custom Tool Wrapper

```python
from langchain.tools import tool
import requests

@tool
def create_purchase_order(amount: int, category: str, purpose: str) -> str:
    """Create a verified purchase order through AgentShield financial firewall."""
    res = requests.post(
        "http://localhost:8000/api/v1/agent/execute",
        json={
            "session_id": "active_user_session",
            "tool_name": "create_order",
            "arguments": {
                "amount": amount,
                "category": category,
                "purpose": purpose,
                "currency": "INR"
            }
        }
    )
    data = res.json()
    if data["decision"] == "ALLOW":
        return f"Order approved on Razorpay. Order ID: {data['provider_result']['order']['id']}"
    elif data["decision"] == "REVIEW":
        return f"Order exceeds review threshold and is pending human approval (Approval ID: {data['approval_id']})."
    else:
        return f"Order BLOCKED by AgentShield: {', '.join(data['reasons'])}"
```

#### TypeScript / Node.js (`fetch`)

```typescript
interface AgentShieldResult {
  decision: 'ALLOW' | 'BLOCK' | 'REVIEW';
  risk_score: number;
  reasons: string[];
  provider_result?: {
    order?: { id: string; amount: number; currency: string };
  };
  approval_id?: string;
}

export async function executeSecureTool(
  sessionId: string,
  toolName: string,
  args: Record<string, any>
): Promise<AgentShieldResult> {
  const res = await fetch("http://localhost:8000/api/v1/agent/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      tool_name: toolName,
      arguments: args,
      agent_id: "typescript_agent"
    })
  });
  return res.json();
}
```

---

### Pattern B: Managed Prompt Interception

If you want AgentShield to manage the LLM reasoning (via hosted NVIDIA NIM) and intercept the generated tool proposal automatically:

```bash
curl -X POST http://localhost:8000/api/v1/agent/run \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "shopper_01",
    "user_prompt": "Buy running shoes for ₹1,500"
  }'
```

Response:

```json
{
  "llm_provider": "NvidiaNIMProvider",
  "user_prompt": "Buy running shoes for ₹1,500",
  "authorized_intent": {
    "category": "footwear",
    "purpose": "running shoes",
    "max_amount": 5000,
    "currency": "INR"
  },
  "proposed_tool_call": {
    "tool_name": "create_order",
    "arguments": {
      "amount": 1500,
      "category": "footwear",
      "purpose": "running shoes",
      "currency": "INR"
    }
  },
  "decision": "ALLOW",
  "execution": {
    "decision": "ALLOW",
    "risk_score": 0.0,
    "transaction_id": "txn_8c1b3f...",
    "provider_result": {
      "order": {
        "id": "order_Rzp123...",
        "amount": 1500,
        "currency": "INR"
      }
    }
  }
}
```

---

## 4. Session & Policy Lifecycle

Before dispatching agent requests, you can initialize or update a user's session policy and authorized intent envelope:

```python
import requests

# Set session policy and intent
requests.post(
    "http://localhost:8000/api/v1/sessions",
    json={
        "session_id": "user_session_101",
        "policy": {
            "allowed_tools": ["create_order", "fetch_order"],
            "max_transaction_amount": 5000,
            "max_session_spend": 10000,
            "max_requests_per_window": 4,
            "window_seconds": 60,
            "require_approval_above": 3000
        },
        "intent": {
            "category": "footwear",
            "purpose": "running shoes",
            "max_amount": 5000,
            "currency": "INR"
        }
    }
)
```

---

## 5. Human-in-the-Loop Review Handling

When a transaction triggers operator review (`decision == "REVIEW"`), spend is atomically reserved in `PENDING` state. An operator or automated compliance system can approve or reject the request:

```bash
# Approve and dispatch to payment provider
curl -X POST http://localhost:8000/api/v1/approvals/appr_xyz/approve \
  -H "Content-Type: application/json" \
  -d '{"reviewed_by": "sec_operator", "review_notes": "Verified high-value order"}'

# Reject and release spend reservation
curl -X POST http://localhost:8000/api/v1/approvals/appr_xyz/reject \
  -H "Content-Type: application/json" \
  -d '{"reviewed_by": "sec_operator", "review_notes": "Exceeded manual budget"}'
```

---

## 6. Payment Signature Verification

When a client checkout completes on Razorpay, verify the HMAC-SHA256 signature against `RAZORPAY_KEY_SECRET` to commit the transaction to `SUCCEEDED`:

```bash
curl -X POST http://localhost:8000/api/v1/payments/verify \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "user_session_101",
    "razorpay_order_id": "order_Rzp123",
    "razorpay_payment_id": "pay_Rzp456",
    "razorpay_signature": "e2c5...signature_hex",
    "transaction_id": "txn_8c1b3f..."
  }'
```

---

## 7. Extending Payment & LLM Providers

AgentShield uses clean protocols (`Protocol`) defined in Python:

- **New Payment Gateway**: Implement `PaymentProvider` in `app/providers/payments/base.py` (`create_order`, `fetch_order`).
- **New LLM Provider**: Implement `LLMProvider` in `app/providers/llm/base.py` (`chat_complete`, `extract_intent`, `compare_semantic_intent`).
- **New Policy Backend**: Implement `PolicyProvider` in `app/agentshield/policy_provider.py`.

Any implementation conforming to these interfaces plugs into the `AgentShield` executor without touching the core validation pipeline.
