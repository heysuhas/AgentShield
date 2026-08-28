# AgentShield Architecture & Threat Model

AgentShield is an authorization, intent verification, and risk management layer positioned directly between autonomous AI agents and financial payment infrastructure.

```text
Any External AI Agent (LangChain / CrewAI / AutoGen / Custom)
    │
    │ POST /api/v1/agent/execute  (or /api/v1/agent/run)
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

---

## 1. Core Invariants

1. **The agent may request an action. The agent never authorizes its own action.**
   Every financial operation initiated by an autonomous agent is treated as an untrusted proposal.

2. **Deterministic enforcement first.**
   Probabilistic LLMs are never used for hard access-control decisions. Tool permissions, per-transaction limits, session budgets, and velocity sliding windows are evaluated deterministically in Python/SQLAlchemy.

3. **Semantic intent as structured evidence.**
   NVIDIA NIM (`meta/llama-3.1-8b-instruct`) provides structured semantic comparison between the user's natural language authorized intent and the candidate tool arguments to defeat prompt injections and category hijacking.

---

## 2. Component Breakdown

### Security Kernel (`backend/app/agentshield/`)
- **`executor.py`**: Central orchestrator. Enforces the strict sequential verification pipeline, manages spend reservations, dispatches to providers, and records audit trails.
- **`policy_engine.py`**: Pure deterministic policy evaluation for tool whitelists, transaction spending caps, and session budgets.
- **`intent_validator.py`**: Deterministic intent matcher (checking categories, purposes, merchants, recipients, and bounds).
- **`velocity.py`**: Sliding-window rate limiters checking request frequency and short-term burst spend.
- **`risk_engine.py`**: Explainable risk scoring combining policy violations, semantic confidence, and behavioral signals.
- **`approval.py`**: State machine (`PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`) for human-in-the-loop escalation of high-value transactions.
- **`transaction.py`**: Finite-state transaction lifecycle (`REQUESTED`, `AUTHORIZED`, `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELLED`).
- **`audit.py`**: Append-only audit logger capturing full decision context, risk evidence, and provider receipts.

### Model Providers (`backend/app/providers/llm/`)
- **`NvidiaNIMProvider`**: Hosted NVIDIA NIM OpenAI-compatible client for intent extraction and semantic comparison.
- **`MockLLMProvider`**: Deterministic mock provider for local unit testing and offline development.

### Payment Providers (`backend/app/providers/payments/`)
- **`RazorpaySandboxProvider`**: Real integration with Razorpay sandbox APIs with automatic paise subunit conversion ($₹\text{INR} \times 100$), idempotency keys, and HMAC-SHA256 signature verification.
- **`MockPaymentProvider`**: Deterministic stateful mock payment provider for automated testing and standalone fixtures.

### Database Persistence (`backend/app/db/`)
- **SQLAlchemy 2.0 & PostgreSQL**: Models for sessions, policies, authorized intents, transactions, approvals, and audit events. Includes row locking (`SELECT ... FOR UPDATE`) and in-memory fallback locks for race-free concurrency.

---

## 3. Threat Model & Mitigations

| Threat Vector | Attack Scenario | AgentShield Mitigation |
|---|---|---|
| **Semantic Category Hijacking** | Agent prompted to buy running shoes attempts to purchase liquid gift cards or crypto vouchers. | `intent_validator.py` + `NvidiaNIMProvider` detect semantic category mismatch and **BLOCK** before payment rails. |
| **Indirect Prompt Injection** | Malicious seller metadata, reviews, or product descriptions inject instructions to transfer funds to an attacker. | Deterministic tool whitelist and semantic intent comparison reject the unauthorized tool call. |
| **Budget Salami Attack** | Rapid sequence of micro-transactions attempting to exceed session budget. | Atomic spend reservation ledger locks funds; `MAX_SESSION_SPEND` rule blocks aggregate overflow. |
| **Runaway Agent / Bot Flood** | Agent enters infinite loop or card-testing bot attack. | `VelocityEngine` sliding-window checks block transactions exceeding request rate or burst spend. |
| **High-Value Exposure** | Agent attempts large transaction above authorized threshold. | Automated routing to human-in-the-loop operator queue in `PENDING` state with funds reserved. |
