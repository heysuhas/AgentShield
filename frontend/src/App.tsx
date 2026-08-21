import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronDown, CircleAlert, CircleCheck, Clock3, Loader2, LockKeyhole, RefreshCw, X } from 'lucide-react'
import { approveReview, createOrInitSession, fetchApprovals, fetchAuditEvents, fetchHealth, fetchPaymentConfig, rejectReview, resetSessionSpend, runAgent, verifyPayment } from './api'
import type { ApprovalRecord, AuditEvent, SessionData } from './types'

const EXAMPLES = [
  { label: 'Keyboard (₹1.5k)', value: 'Buy a mechanical keyboard for ₹1,500' },
  { label: 'Shoes (₹1.5k)', value: 'Buy running shoes for ₹1,500' },
  { label: 'Monitor (₹4.5k Review)', value: 'Buy an office monitor for ₹4,500' },
  { label: 'Gift Card (Injection)', value: 'Buy a ₹4,999 Amazon gift card' },
]

declare global { interface Window { Razorpay?: any } }

type Result = any

function decisionOf(result: Result): 'ALLOW' | 'REVIEW' | 'BLOCK' | null {
  return result?.decision ?? result?.execution?.decision ?? null
}
function executionOf(result: Result): Result { return result?.execution ?? result }
function orderOf(result: Result): Result | null { return executionOf(result)?.provider_result?.order ?? null }
function money(value: number | null | undefined) { return `₹${(value ?? 0).toLocaleString('en-IN')}` }
function reasonText(result: Result) {
  const execution = executionOf(result)
  if (execution?.reasons?.length) return execution.reasons
  if (execution?.policy_violations?.length) return execution.policy_violations.map((v: any) => v.rule)
  return []
}

function DecisionRail({ decision }: { decision: ReturnType<typeof decisionOf> }) {
  const steps = [
    { label: 'Request', state: decision ? 'done' : 'current' },
    { label: decision === 'REVIEW' ? 'Review' : 'AgentShield', state: decision ? 'current' : 'idle' },
    { label: 'Payment', state: decision === 'ALLOW' ? 'current' : 'idle' },
  ]
  return <div className={`decision-rail rail-${decision?.toLowerCase() ?? 'idle'}`} aria-label="Request flow">
    {steps.map((step, index) => <div className="rail-step" key={step.label}>
      <span className={`rail-dot ${step.state}`} />
      <span>{step.label}</span>
      {index < steps.length - 1 && <span className="rail-line" />}
    </div>)}
  </div>
}

function StatusMark({ decision }: { decision: string | null }) {
  if (decision === 'ALLOW') return <span className="status-mark allowed"><Check size={16} /></span>
  if (decision === 'REVIEW') return <span className="status-mark review"><Clock3 size={16} /></span>
  return <span className="status-mark blocked"><X size={16} /></span>
}
function formatEventTime(timestamp: string | Date | undefined) {
  if (!timestamp) return 'Just now'
  let str = String(timestamp).trim()
  if (!str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) {
    str = str.replace(' ', 'T') + 'Z'
  }
  const date = new Date(str)
  if (isNaN(date.getTime())) return 'Just now'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function App() {
  const [sessionId, setSessionId] = useState('demo_shopper_01')
  const [showSessionModal, setShowSessionModal] = useState(false)
  const [customSessionInput, setCustomSessionInput] = useState('')
  const [prompt, setPrompt] = useState(EXAMPLES[0].value)
  const [session, setSession] = useState<SessionData | null>(null)
  const [result, setResult] = useState<Result>(null)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([])
  const [health, setHealth] = useState<any>(null)
  const [paymentConfig, setPaymentConfig] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null)
  const [resettingSpend, setResettingSpend] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [nextSession, audit, pending, nextHealth, config] = await Promise.all([
        createOrInitSession(sessionId),
        fetchAuditEvents(sessionId, undefined, undefined, 8),
        fetchApprovals(sessionId, 'PENDING', 10),
        fetchHealth().catch(() => ({ status: 'offline' })),
        fetchPaymentConfig().catch(() => null),
      ])
      setSession(nextSession)
      setEvents(audit.items)
      setApprovals(pending.items)
      setHealth(nextHealth)
      setPaymentConfig(config)
    } catch (cause: any) { setError(cause.message || 'Could not connect to AgentShield') }
  }, [sessionId])

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(timer) }, [refresh])

  const decision = decisionOf(result)
  const execution = executionOf(result)
  const order = orderOf(result)
  const isRazorpay = paymentConfig?.provider === 'razorpay' && Boolean(paymentConfig?.key_id)
  const spendPercent = session?.policy?.max_session_spend ? Math.min(100, (session.total_active_spend / session.policy.max_session_spend) * 100) : 0
  const statusCopy = useMemo(() => ({
    ALLOW: { title: 'Payment is authorized', body: 'The request matched the session policy and authorized intent.' },
    REVIEW: { title: 'A human decision is required', body: 'The amount is held safely until an operator approves or rejects it.' },
    BLOCK: { title: 'Payment was blocked', body: 'AgentShield stopped the request before it reached the payment provider.' },
  } as const), [])

  const submit = async (value = prompt) => {
    if (!value.trim() || loading) return
    setLoading(true); setError(null); setPaymentMessage(null); setShowDetails(false)
    try { setPrompt(value); setResult(await runAgent(sessionId, value)); await refresh() }
    catch (cause: any) { setError(cause.message || 'The agent could not complete the request'); setResult(null) }
    finally { setLoading(false) }
  }

  const openCheckout = () => {
    if (!window.Razorpay || !isRazorpay || !order?.id || !execution?.transaction_id) {
      setPaymentMessage('Checkout is unavailable until a real Razorpay order and transaction are returned.')
      return
    }
    const amount = Number(order.amount ?? execution?.provider_result?.order?.amount ?? 0) * 100
    try {
      const checkout = new window.Razorpay({
        key: paymentConfig.key_id,
        order_id: order.id,
        amount,
        currency: order.currency || 'INR',
        name: 'AgentShield',
        description: 'Authorized purchase',
        theme: { color: '#18d5c5' },
        method: { upi: true, card: true, netbanking: true, wallet: true, paylater: true },
        config: {
          display: {
            sequence: ['upi', 'card', 'netbanking', 'wallet', 'paylater'],
            preferences: { show_default_blocks: true },
          },
        },
        notes: { session_id: sessionId, transaction_id: execution.transaction_id },
        handler: async (response: any) => {
          if (!response?.razorpay_order_id || !response?.razorpay_payment_id || !response?.razorpay_signature) {
            setPaymentMessage('Razorpay returned an incomplete payment response. Nothing was marked successful.')
            return
          }
          try {
            const verified = await verifyPayment({ session_id: sessionId, transaction_id: execution.transaction_id, razorpay_order_id: response.razorpay_order_id, razorpay_payment_id: response.razorpay_payment_id, razorpay_signature: response.razorpay_signature })
            setPaymentMessage(verified.message); await refresh()
          } catch (cause: any) { setPaymentMessage(cause.message || 'Payment verification failed') }
        },
      })
      checkout.on('payment.failed', (response: any) => setPaymentMessage(response?.error?.description || 'Payment was not completed'))
      checkout.open()
    } catch (cause: any) { setPaymentMessage(cause.message || 'Could not open Razorpay Checkout') }
  }

  const review = async (approvalId: string, approve: boolean) => {
    setReviewing(approvalId); setError(null)
    try { setResult(approve ? await approveReview(approvalId) : await rejectReview(approvalId)); await refresh() }
    catch (cause: any) { setError(cause.message || 'Could not update the review') }
    finally { setReviewing(null) }
  }

  const resetSpend = async () => {
    setResettingSpend(true); setError(null); setPaymentMessage(null)
    try {
      const updated = await resetSessionSpend(sessionId)
      setSession(updated)
      setPaymentMessage('Session spend was reset. Existing audit and transaction history is preserved.')
      await refresh()
    } catch (cause: any) { setError(cause.message || 'Could not reset session spend') }
    finally { setResettingSpend(false) }
  }

  const handleSwitchSession = (newId: string) => {
    const trimmed = newId.trim()
    if (!trimmed) return
    setSessionId(trimmed)
    setResult(null)
    setError(null)
    setPaymentMessage(null)
    setShowSessionModal(false)
    setCustomSessionInput('')
  }

function AgentShieldLogo() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark-seal">
        <svg viewBox="0 0 24 24" fill="none" className="brand-svg">
          <path d="M12 2.5L20 6.2V11.5C20 16.8 16.5 20.8 12 22C7.5 20.8 4 16.8 4 11.5V6.2L12 2.5Z" stroke="#E5E7EB" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="12" cy="11" r="2.2" fill="#E5E7EB" />
          <path d="M12 13.5V17" stroke="#E5E7EB" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <div className="brand-text-wrap">
        <span className="brand-title">AgentShield</span>
        <span className="brand-tag">TRUST GATE</span>
      </div>
    </div>
  )
}

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><AgentShieldLogo /></div>
      <div className="topbar-meta">
        <span className={`service-dot ${health?.status === 'offline' ? 'offline' : ''}`} /> 
        <span>{health?.status === 'offline' ? 'Offline' : 'Sandbox connected'}</span>
        <button className="session-chip-button" onClick={() => setShowSessionModal(true)} title="Switch User / Session">
          <span>👤 {sessionId}</span>
          <ChevronDown size={12} />
        </button>
      </div>
    </header>

    {showSessionModal && <div className="modal-backdrop" onClick={() => setShowSessionModal(false)}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Identity & Session</p>
            <h3>Switch User / Agent Session</h3>
          </div>
          <button className="icon-button" onClick={() => setShowSessionModal(false)}><X size={15} /></button>
        </div>
        <p className="intro-copy" style={{ fontSize: '13px', marginBottom: '14px' }}>
          Each user identity gets an isolated spending ledger, dynamic intent, and audit trail.
        </p>
        <p className="eyebrow" style={{ margin: '14px 0 6px' }}>Quick Select</p>
        <div className="modal-presets">
          {['demo_shopper_01', 'shopper_alice_02', 'procurement_bot_03', 'risk_tester_04'].map(id => (
            <button 
              key={id} 
              className={`modal-preset-btn ${sessionId === id ? 'active' : ''}`}
              onClick={() => handleSwitchSession(id)}
            >
              {id}
            </button>
          ))}
        </div>
        <p className="eyebrow" style={{ margin: '14px 0 6px' }}>Or Enter Custom User ID</p>
        <form onSubmit={e => { e.preventDefault(); handleSwitchSession(customSessionInput) }}>
          <input 
            type="text" 
            className="modal-input" 
            placeholder="e.g. user_bob_finance" 
            value={customSessionInput}
            onChange={e => setCustomSessionInput(e.target.value)}
            autoFocus
          />
          <div className="modal-actions">
            <button type="button" className="quiet-button" onClick={() => setShowSessionModal(false)}>Cancel</button>
            <button type="submit" className="primary-button" disabled={!customSessionInput.trim()}>Switch User</button>
          </div>
        </form>
      </div>
    </div>}

    <main className="workspace">
      <section className="intro">
        <div><p className="eyebrow">Protected payments for AI agents</p><h1>Let the agent ask.<br /><em>Keep the decision yours.</em></h1><p className="intro-copy">Describe a purchase. AgentShield checks the request against your intent and spending rules before any payment is created.</p></div>
        <div className="policy-note"><LockKeyhole size={15} /><div><strong>Session protected</strong><span>{money(session?.policy?.max_transaction_amount)} per purchase · {money(session?.policy?.max_session_spend)} total</span></div></div>
      </section>

      <DecisionRail decision={decision} />

      <section className="main-grid">
        <div className="left-column">
          <div className="panel request-panel">
            <div className="panel-heading"><div><p className="eyebrow">Your request</p><h2>What do you want to buy?</h2></div><span className="model-label">{health?.model || 'NVIDIA NIM'}</span></div>
            <textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit() }} placeholder="Buy running shoes for ₹1,500" rows={3} />
            <div className="request-footer"><div className="examples">{EXAMPLES.map(example => <button key={example.label} onClick={() => setPrompt(example.value)} className="example-button">{example.label}</button>)}</div><button className="primary-button" onClick={() => void submit()} disabled={loading || !prompt.trim()}>{loading ? <><Loader2 size={16} className="spin" /> Checking</> : <>Check request <ArrowRight size={16} /></>}</button></div>
            <p className="hint">Press ⌘ Enter to submit · The model can propose, but it cannot authorize.</p>
          </div>

          {result && decision && <div className={`panel decision-panel ${decision.toLowerCase()}`}>
            <div className="decision-heading"><StatusMark decision={decision} /><div><p className="eyebrow">AgentShield decision</p><h2>{statusCopy[decision].title}</h2></div><span className="decision-word">{decision}</span></div>
            <p className="decision-body">{statusCopy[decision].body}</p>
            <div className="proposal"><span>Agent proposed</span><code>{execution?.tool_name || result.proposed_tool_call?.tool_name || 'create_order'}</code><strong>{money(execution?.arguments?.amount || result.proposed_tool_call?.arguments?.amount)}</strong><span>{execution?.arguments?.category || result.proposed_tool_call?.arguments?.category || '—'}</span></div>
            {decision === 'ALLOW' && order?.id && <div className="payment-action"><div><strong>Payment order ready</strong><span>{order.id}</span></div><button className="payment-button" onClick={openCheckout}>Open secure checkout <ArrowRight size={15} /></button></div>}
            {decision === 'REVIEW' && <div className="inline-note review-note"><Clock3 size={16} /><span>Approval is waiting below. No payment provider has been called.</span></div>}
            {decision === 'BLOCK' && <div className="reason-list"><strong>Why it stopped</strong>{reasonText(result).map((reason: string) => <span key={reason}><X size={14} />{reason.replaceAll('_', ' ').toLowerCase()}</span>)}</div>}
            {paymentMessage && <div className="inline-note payment-note"><CircleCheck size={16} />{paymentMessage}</div>}
            <button className="details-toggle" onClick={() => setShowDetails(value => !value)}>{showDetails ? 'Hide details' : 'View decision details'} <ChevronDown size={14} className={showDetails ? 'flip' : ''} /></button>
            {showDetails && <pre className="json-view">{JSON.stringify(result, null, 2)}</pre>}
          </div>}

          {error && <div className="error-banner"><CircleAlert size={17} />{error}<button onClick={() => setError(null)}><X size={15} /></button></div>}
        </div>

        <aside className="right-column">
          {approvals.length > 0 && <div className="panel approval-panel"><div className="panel-heading compact"><div><p className="eyebrow amber">Action needed</p><h2>Review purchase</h2></div><span className="count-badge">{approvals.length}</span></div>{approvals.map(item => <div className="approval-item" key={item.approval_id}><div className="approval-summary"><strong>{money(item.amount)} purchase</strong><span>{item.arguments?.category || 'Purchase'} · {item.transaction_id.slice(0, 14)}…</span></div><div className="approval-actions"><button onClick={() => void review(item.approval_id, false)} disabled={reviewing === item.approval_id} className="quiet-button">Reject</button><button onClick={() => void review(item.approval_id, true)} disabled={reviewing === item.approval_id} className="approve-button">Approve</button></div></div>)}</div>}
          <div className="panel activity-panel"><div className="panel-heading compact"><div><p className="eyebrow">Recent activity</p><h2>What happened</h2></div><button className="icon-button" onClick={() => void refresh()} aria-label="Refresh activity"><RefreshCw size={15} /></button></div>{events.length === 0 ? <p className="empty-state">Your first decision will appear here.</p> : <div className="activity-list">{events.map(event => <div className="activity-item" key={event.event_id}><StatusMark decision={event.decision} /><div><strong>{event.decision === 'ALLOW' ? 'Authorized purchase' : event.decision === 'REVIEW' ? 'Waiting for approval' : 'Request blocked'}</strong><span>{event.tool_name} · {formatEventTime(event.timestamp)}</span></div><b>{money(event.arguments?.amount)}</b></div>)}</div>}</div>
          <div className="spend-panel"><div className="spend-heading"><div><span>Session spend</span><strong>{money(session?.total_active_spend)}</strong></div><button className="reset-button" onClick={() => void resetSpend()} disabled={resettingSpend} title="Reset current session spend"><RefreshCw size={12} className={resettingSpend ? 'spin' : ''} /> {resettingSpend ? 'Resetting' : 'Reset spend'}</button></div><div className="spend-track"><span style={{ width: `${spendPercent}%` }} /></div><div className="spend-footer"><span>{money(session?.committed_spend)} settled</span><span>{money(session?.policy?.max_session_spend)} limit</span></div></div>
        </aside>
      </section>
      <footer className="footer"><span>AgentShield decides before money moves.</span><span>{isRazorpay ? 'Razorpay test mode' : 'Mock payment mode'} · API v1</span></footer>
    </main>
  </div>
}
