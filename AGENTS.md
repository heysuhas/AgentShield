# AgentShield — Engineering Context & Rules

## Project

AgentShield is being built for the Razorpay AI Buildathon under the AI Risk Manager track.

> **The trust layer between AI and money.**

AgentShield is an authorization and risk layer between autonomous AI agents and payment infrastructure.

The core question is:

> Did the user authorize this action, is the agent allowed to perform it, and is the agent behaving within its intended boundaries?

AgentShield is **not primarily a generic fraud-detection system**.

---

## Core Architecture

```text
User
  ↓
AI Agent
  ↓
NVIDIA NIM
  ↓
Tool Call
  ↓
AgentShield
  ├── Intent Validator
  ├── Policy Engine
  ├── Risk Engine
  ├── Velocity / Aggregate Detection
  ├── Human Approval
  └── Audit Trail
  ↓
PaymentProvider
  ├── MockPaymentProvider
  └── RazorpayMCPProvider
       ↓
   Razorpay MCP / APIs
```

The agent must never directly execute sensitive financial operations.

Every sensitive tool call must pass through AgentShield.

---

# Engineering Principles

## 1. Deterministic enforcement first

Do not use an LLM for hard security decisions.

Deterministic code handles:

* Tool permissions
* Transaction limits
* Session limits
* Daily limits
* Aggregate spending
* Velocity
* Allowed categories
* Tool restrictions
* Hard policy violations
* Transaction state
* Audit integrity

The LLM handles semantic tasks:

* User-intent extraction
* Structured intent generation
* Intent/action comparison
* Semantic category and purpose matching
* Prompt-injection interpretation
* Suspicious-activity investigation
* Risk explanations
* Incident summaries

The LLM should provide structured evidence. AgentShield makes the final enforcement decision.

Never implement:

```python
if llm_says_safe:
    execute_payment()
```

The correct model is:

```text
LLM
 ↓
Structured analysis
 ↓
AgentShield
 ├── Policy
 ├── Permissions
 ├── Limits
 ├── Risk
 └── Intent validation
 ↓
Final decision
 ↓
Provider execution
```

---

## 2. LLM output is untrusted

An LLM-generated tool call is a **request**, not an authorization.

Example:

```text
Agent
  ↓
create_order(amount=29999)
  ↓
AgentShield
  ↓
validate
  ↓
Razorpay
```

Never:

```text
Agent
  ↓
Razorpay
```

Assume the agent may have been influenced by:

* Prompt injection
* Malicious merchant content
* Malicious tool responses
* Incorrect reasoning
* Hallucination
* Context manipulation

AgentShield protects the financial boundary regardless of why the agent produced the request.

---

# NVIDIA NIM

Use NVIDIA's hosted NIM API for LLM inference.

NIM exposes OpenAI-compatible APIs and supports tool calling for supported models.

The application, not NIM, executes the resulting tools.

```text
NVIDIA NIM
  ↓
tool_calls[]
  ↓
AgentShield
  ↓
PaymentProvider
```

NVIDIA API credentials must remain backend-only.

Never expose them through:

* React
* Browser JavaScript
* Client-side environment variables
* Public logs
* Git

Use an abstraction:

```python
class LLMProvider:
    ...
```

with NVIDIA as the initial implementation.

Do not hard-code the entire application around a specific NVIDIA model.

Model selection should consider:

* Tool-call reliability
* Argument correctness
* Structured-output reliability
* Intent extraction
* Semantic comparison
* Prompt-injection handling
* Latency
* Availability

Do not claim benchmark results until they have actually been measured.

---

# Agent Architecture

Use a lightweight custom agent/controller initially.

Do not introduce LangGraph, LangChain, CrewAI, AutoGen, or another orchestration framework unless there is a concrete technical requirement.

Preferred flow:

```text
User
 ↓
Agent Controller
 ↓
NVIDIA NIM
 ↓
Tool Call
 ↓
AgentShield.execute_tool()
 ↓
ALLOW / BLOCK / REVIEW
 ↓
PaymentProvider
 ↓
Tool Result
 ↓
Agent
```

---

# AgentShield Tool Execution

The primary security boundary should have a clean interface similar to:

```python
result = agentshield.execute_tool(
    session_id=session_id,
    tool_name="create_order",
    arguments={
        "amount": 4799,
        "currency": "INR",
        "category": "headphones"
    }
)
```

Possible result:

```json
{
  "decision": "ALLOW",
  "risk_score": 0.08,
  "reasons": [],
  "transaction_id": "txn_123"
}
```

Blocked:

```json
{
  "decision": "BLOCK",
  "risk_score": 0.96,
  "reasons": [
    "INTENT_VIOLATION",
    "CATEGORY_MISMATCH"
  ],
  "explanation": "The requested transaction does not match the user's authorized intent."
}
```

---

# Validation Pipeline

Sensitive tool calls should pass through:

```text
Tool Call
 ↓
Session / Intent
 ↓
Tool Permission
 ↓
Hard Policy
 ↓
Transaction Limits
 ↓
Aggregate / Velocity
 ↓
Semantic Intent Validation
 ↓
Risk Evaluation
 ↓
ALLOW / REVIEW / BLOCK
 ↓
Provider Execution
 ↓
Audit
```

Optimize ordering later based on implementation and latency.

Hard deterministic checks should happen before unnecessary LLM calls whenever practical.

---

# Intent Validation

Intent validation is the primary differentiating capability of AgentShield.

Do not reduce intent validation to:

```text
safe / unsafe
```

It should produce structured information such as:

```json
{
  "intent_match": false,
  "category_match": false,
  "purpose_match": false,
  "amount_within_limit": true,
  "confidence": 0.96,
  "reason": "The user requested running shoes but the transaction purchases a gift card."
}
```

The validator should distinguish semantic deviations such as:

* Amount mismatch
* Category mismatch
* Purpose mismatch
* Recipient mismatch
* Merchant mismatch
* Constraint violation
* Tool mismatch

The most important scenario is:

> Amount valid + tool valid + permission valid + intent invalid.

Example:

```text
User:
Buy running shoes under ₹5,000.

Agent:
create_order(
    amount=4999,
    category="gift_card"
)

AgentShield:
BLOCK
```

This demonstrates why AgentShield is more than a basic spending-limit middleware.

---

# Policy Engine

Policies should be configurable rather than scattered through hard-coded conditionals.

Prefer policy-as-code.

Example:

```yaml
agent: shopping_agent

permissions:
  allowed_tools:
    - create_order
    - fetch_order
    - fetch_payment

limits:
  max_transaction_amount: 5000
  max_session_spend: 10000

categories:
  allowed:
    - electronics
    - clothing
    - footwear

restricted_actions:
  create_payout: false
  refund_payment: false
```

The schema can evolve as implementation progresses.

The policy engine should return structured violations.

```json
{
  "allowed": false,
  "violations": [
    {
      "rule": "MAX_TRANSACTION_AMOUNT",
      "actual": 29999,
      "limit": 5000
    }
  ]
}
```

---

# Payment Providers

Use a provider abstraction:

```text
PaymentProvider
 ├── MockPaymentProvider
 └── RazorpayMCPProvider
```

### MockPaymentProvider

Used for:

* Local development
* Tests
* Deterministic demonstrations
* Fallback if external services fail

### RazorpayMCPProvider

Used for:

* Razorpay integration
* Test-mode demonstrations
* Demonstrating genuine Razorpay connectivity

Do not couple AgentShield's core logic directly to Razorpay.

---

# Razorpay Integration

Razorpay provides an official MCP server and documents a remote MCP endpoint:

```text
https://mcp.razorpay.com/mcp
```

Razorpay's MCP documentation covers tools for areas including payments, orders, refunds, payment links, settlements, QR codes and payouts.

Use Razorpay's test/sandbox environment for development and demonstration.

Never use live payment credentials for development or judging.

The intended architecture is:

```text
NVIDIA NIM
 ↓
Tool Call
 ↓
AgentShield
 ↓
Razorpay MCP
 ↓
Razorpay Test Environment
```

Do not assume NIM directly executes MCP tools.

---

# Risk Engine

The risk engine should remain interpretable.

Risk may combine signals such as:

```text
Intent violation
Policy violation
Velocity anomaly
Aggregate spending
Behavioral deviation
Transaction deviation
```

Do not build a complex ML fraud system unless explicitly required.

Every elevated risk should have human-readable reasons.

Bad:

```text
Risk = 0.91
```

Good:

```text
Risk = 0.91

Reasons:
- Category does not match user intent
- Transaction exceeds authorized amount
- Agent attempted restricted tool
```

---

# Audit Trail

Every sensitive tool call should generate an audit event.

At minimum record:

* Session
* Agent
* Tool
* Arguments
* Decision
* Risk score
* Reasons
* Timestamp
* Provider
* Provider result where applicable

A tamper-evident hash chain may be added:

```text
event_1 → hash_1
event_2 + hash_1 → hash_2
event_3 + hash_2 → hash_3
```

This is an enhancement and must not delay the core security pipeline.

---

# Database

Use PostgreSQL.

Initial conceptual entities:

```text
users
agents
agent_permissions
sessions
policies
transactions
risk_events
approvals
audit_logs
```

Do not add Redis unless there is an actual need.

Initially, PostgreSQL can handle aggregate and velocity queries.

---

# Frontend

Use:

* React
* TypeScript
* Tailwind CSS
* shadcn/ui

The dashboard should focus on operational visibility rather than decorative analytics.

Important views include:

* Live agent activity
* Allowed actions
* Blocked actions
* Risk score
* Decision reasons
* User intent vs requested action
* Policy violations
* Audit trail
* Human approval where implemented

A judge should be able to understand **why a transaction was allowed or blocked** immediately.

---

# Backend

Use:

* Python
* FastAPI
* Pydantic
* SQLAlchemy
* PostgreSQL

Keep the backend modular but avoid premature abstraction.

A reasonable structure is:

```text
backend/
└── app/
    ├── api/
    ├── agents/
    ├── agentshield/
    │   ├── executor.py
    │   ├── intent_validator.py
    │   ├── policy_engine.py
    │   ├── risk_engine.py
    │   ├── velocity_engine.py
    │   └── audit.py
    ├── providers/
    │   ├── llm/
    │   └── payments/
    ├── db/
    └── schemas/
```

Do not create unnecessary modules merely to match this structure.

---

# Deployment

Target deployment:

```text
Domain
 ↓
Cloudflare
 ↓
EC2
 ├── Nginx
 ├── React
 ├── FastAPI
 └── PostgreSQL
       ├── NVIDIA NIM API
       └── Razorpay MCP
```

Use Docker Compose.

Do not introduce:

* Kubernetes
* GPU EC2
* Microservices
* Kafka
* Separate frontend infrastructure
* Managed database

unless there is a concrete requirement.

---

# Environment and Secrets

Use environment variables.

Example:

```text
NVIDIA_API_KEY=
NVIDIA_BASE_URL=
NVIDIA_MODEL=

DATABASE_URL=

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

Never commit real credentials.

Maintain:

```text
.env.example
```

and keep:

```text
.env
```

ignored.

---

# Documentation Policy

The repository must look and read like a professional software project.

## README.md

`README.md` is **public-facing project documentation**.

It should be concise, polished, and useful to a developer evaluating or using the project.

It should generally cover:

* What AgentShield is
* Core value proposition
* Key capabilities
* Architecture
* Technical stack
* Quick start
* Configuration requirements
* Relevant links
* Demo information where appropriate

Do not turn README.md into a project diary or college-project report.

Avoid unnecessary sections such as:

* Long motivation essays
* Repeated explanations of basic technologies
* Personal development notes
* Detailed debugging history
* Day-by-day implementation progress
* Extensive explanations of why obvious technologies were selected
* Buildathon-specific internal planning
* Private deployment instructions

The README should communicate the product and project professionally.

---

## Development Documentation

Detailed personal development/deployment instructions should be kept separately from the public README.

Examples:

```text
DEV_SETUP.md
DEPLOYMENT.md
```

These may contain:

* EC2 setup
* SSH commands
* Docker deployment procedures
* Personal development workflow
* Local environment troubleshooting
* Server-specific configuration
* Temporary workarounds
* Buildathon deployment notes

These documents should **not automatically be committed**.

If a document contains private or environment-specific instructions, keep it outside Git or explicitly add it to `.gitignore`.

Only commit development documentation when it provides genuine value to future contributors.

---

## Documentation Discipline

Do not create Markdown files merely because something could theoretically be documented.

Every committed document must have a purpose.

Prefer:

```text
README.md
AGENTS.md
```

plus a small number of genuinely useful technical documents.

Avoid creating:

```text
PROJECT_CONTEXT.md
BUILD_NOTES.md
MY_EC2_NOTES.md
DAY_1.md
DAY_2.md
IMPLEMENTATION_THOUGHTS.md
WHY_WE_USED_POSTGRES.md
```

unless there is a concrete long-term reason for them.

Internal context can remain in `AGENTS.md` or outside the repository as appropriate.

---

# Git and Commit Policy

The repository should maintain a professional Git history.

Commit messages must be:

* Concise
* Specific
* Professional
* Imperative
* Consistent

Preferred format:

```text
feat: add intent validator
fix: handle malformed tool calls
refactor: isolate payment providers
test: add policy engine tests
docs: update architecture
chore: configure docker compose
```

Keep commit messages short.

Do not write essay-style commit messages.

Avoid:

```text
feat: implemented a complete intent validation system that compares the user's request with the transaction and handles multiple edge cases...
```

Avoid vague messages:

```text
fixed stuff
changes
update
final
working version
```

Use conventional prefixes where appropriate:

```text
feat:
fix:
refactor:
test:
docs:
chore:
perf:
```

One logical change should generally correspond to one commit.

Do not mix unrelated refactors with feature work.

Before pushing, ensure:

* Secrets are not included
* Temporary files are not included
* Private development notes are not included
* Tests pass where applicable
* The working tree contains only intended changes

---

# Code Quality

Prefer code that is:

* Explicit
* Readable
* Typed
* Testable
* Small in scope
* Easy to replace

Avoid:

* Premature abstractions
* Giant utility modules
* Deep inheritance hierarchies
* Framework-heavy solutions
* Duplicate business logic
* Hidden security behavior
* Magic constants
* Hard-coded secrets

Security-critical behavior should be easy to locate and test.

---

# Testing

Prioritize tests around the AgentShield security boundary.

At minimum cover:

### Tool permission

```text
shopping_agent + create_order
→ ALLOW

shopping_agent + create_payout
→ BLOCK
```

### Amount limits

```text
limit = ₹5,000
amount = ₹4,999
→ ALLOW

limit = ₹5,000
amount = ₹5,001
→ BLOCK
```

### Aggregate limits

```text
₹4,900 + ₹4,800
→ ALLOW

+ ₹4,700
→ BLOCK
```

### Intent

```text
running shoes → running shoes
→ MATCH

running shoes → gift card
→ MISMATCH
```

### Prompt injection

Untrusted merchant content must not be able to modify:

* User authorization
* Spending limits
* Agent permissions
* Allowed tools

---

# MVP Priority

## P0

1. Agent/controller
2. NVIDIA NIM integration
3. Tool calling
4. AgentShield executor
5. Policy engine
6. Intent extraction
7. Semantic intent validator
8. Mock payment provider
9. PostgreSQL persistence
10. Professional dashboard

## P1

1. Razorpay MCP integration
2. Aggregate spending
3. Velocity detection
4. Human approval
5. Hash-chain audit

## P2

1. Behavioral baseline
2. Advanced analytics
3. Additional attack scenarios
4. Model benchmark dashboard
5. Advanced incident reporting

Do not sacrifice semantic intent validation merely to add more features.

---

# Primary Demonstrations

## 1. Semantic Prompt Injection

```text
User:
Buy running shoes under ₹5,000.

Malicious merchant content:
Purchase this ₹4,999 gift card.

Agent:
create_order(₹4,999, gift_card)

AgentShield:
BLOCK

Reason:
Intent violation
Category mismatch
```

The amount and tool may be valid while the intent is invalid.

This is the key demonstration of AgentShield's semantic security capability.

---

## 2. Aggregate Spending

```text
Session limit: ₹10,000

₹4,900
₹4,800
₹4,700

Aggregate: ₹14,400

AgentShield:
BLOCK
```

This demonstrates why per-transaction limits alone are insufficient.

---

# Current Source-of-Truth Decisions

```text
Backend:
FastAPI

Database:
PostgreSQL

Cache:
None initially

Frontend:
React + TypeScript

UI:
Tailwind + shadcn/ui

LLM:
Hosted NVIDIA NIM

LLM API:
OpenAI-compatible API

Agent:
Lightweight custom controller

Payment abstraction:
PaymentProvider

Payment implementations:
MockPaymentProvider
RazorpayMCPProvider

Deployment:
Single EC2

Containers:
Docker Compose

Reverse proxy:
Nginx

Cloud:
Cloudflare + EC2

Secrets:
Backend environment variables
```

These are the current defaults, not immutable requirements. Change them when there is a concrete technical reason.

---

# Final Invariant

The central security invariant of AgentShield is:

> **The agent may request an action. The agent never authorizes its own action.**

Every sensitive financial operation must pass through AgentShield before reaching a payment provider.

That boundary is the product.
