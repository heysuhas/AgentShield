import React, { useCallback, useEffect, useState } from 'react';
import {
  RotateCcw,
  RefreshCw,
  ChevronRight,
  X,
  Send,
  Copy,
  Terminal,
  AlertTriangle
} from 'lucide-react';
import {
  approveReview,
  createOrInitSession,
  executeToolCall,
  fetchApprovals,
  fetchAuditEvents,
  fetchHealth,
  fetchTransactions,
  reconcileSession,
  rejectReview,
  resetSessionSpend,
  runAgent
} from './api';
import type { ApprovalRecord, AuditEvent, SessionData, Transaction } from './types';

const DEFAULT_SESSION_ID = 'demo_shopper_01';

type ViewMode = 'interceptor' | 'razorpay' | 'attacks' | 'audit';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('interceptor');
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION_ID);
  const [session, setSession] = useState<SessionData | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [, setTransactions] = useState<Transaction[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRecord[]>([]);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Agent Prompt Bar State
  const [agentPrompt, setAgentPrompt] = useState('Buy running shoes under ₹5,000');

  // Direct Razorpay Form State
  const [rzpAmount, setRzpAmount] = useState('1500');
  const [rzpCategory, setRzpCategory] = useState('footwear');
  const [rzpPurpose, setRzpPurpose] = useState('running shoes');
  const [rzpReceipt, setRzpReceipt] = useState('');
  const [rzpLookupId, setRzpLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Load session, audit log, and approvals
  const refreshData = useCallback(async () => {
    try {
      const [sess, audit, txns, approvals, health] = await Promise.all([
        createOrInitSession(sessionId),
        fetchAuditEvents(sessionId, undefined, undefined, 50),
        fetchTransactions(sessionId, undefined, 50),
        fetchApprovals(sessionId, 'PENDING', 20),
        fetchHealth().catch(() => ({ status: 'offline' }))
      ]);
      setSession(sess);
      setAuditEvents(audit.items);
      setTransactions(txns.items);
      setPendingApprovals(approvals.items);
      setSystemHealth(health);
    } catch (e) {
      console.error(e);
    }
  }, [sessionId]);

  useEffect(() => {
    void refreshData();
    const interval = setInterval(() => {
      void refreshData();
    }, 4000);
    return () => clearInterval(interval);
  }, [refreshData]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Execute Agent Request (Natural Language -> NIM -> AgentShield -> Razorpay)
  const handleAgentRun = async (promptToRun?: string) => {
    const text = promptToRun || agentPrompt;
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await runAgent(sessionId, text);
      setLastResult(res);
      await refreshData();
    } catch (err: any) {
      setLastResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Direct Razorpay Order Execution
  const handleDirectRazorpayOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const parsedAmount = parseInt(rzpAmount, 10);
      const res = await executeToolCall(sessionId, 'create_order', {
        amount: parsedAmount,
        currency: 'INR',
        category: rzpCategory,
        purpose: rzpPurpose,
        receipt: rzpReceipt || `rcpt_${Date.now().toString().slice(-6)}`,
      });
      setLastResult(res);
      await refreshData();
    } catch (err: any) {
      setLastResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Direct Razorpay Order Lookup
  const handleLookupOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rzpLookupId.trim()) return;
    setLookupLoading(true);
    try {
      const res = await executeToolCall(sessionId, 'fetch_order', {
        order_id: rzpLookupId.trim(),
      });
      setLookupResult(res);
      await refreshData();
    } catch (err: any) {
      setLookupResult({ error: err.message });
    } finally {
      setLookupLoading(false);
    }
  };

  // 1-Click Scenario Runner
  const handleScenarioRun = async (toolName: string, args: Record<string, any>) => {
    setLoading(true);
    try {
      const res = await executeToolCall(sessionId, toolName, args);
      setLastResult(res);
      await refreshData();
    } catch (err: any) {
      setLastResult({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleVelocityBurst = async () => {
    setLoading(true);
    try {
      for (let i = 0; i < 5; i++) {
        const res = await executeToolCall(sessionId, 'create_order', {
          amount: 500,
          category: 'footwear',
          purpose: 'running shoes',
        });
        setLastResult(res);
      }
      await refreshData();
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (approvalId: string) => {
    setReviewingId(approvalId);
    try {
      const res = await approveReview(approvalId, 'security_operator', 'Authorized by human operator');
      setLastResult(res);
      await refreshData();
    } catch (err: any) {
      alert(`Approval error: ${err.message}`);
    } finally {
      setReviewingId(null);
    }
  };

  const handleReject = async (approvalId: string) => {
    setReviewingId(approvalId);
    try {
      const res = await rejectReview(approvalId, 'security_operator', 'Rejected by human operator');
      setLastResult(res);
      await refreshData();
    } catch (err: any) {
      alert(`Rejection error: ${err.message}`);
    } finally {
      setReviewingId(null);
    }
  };

  const handleResetSpend = async () => {
    if (!session) return;
    const updated = await resetSessionSpend(session.session_id);
    setSession(updated);
    void refreshData();
  };

  const handleReconcile = async () => {
    if (!session) return;
    const updated = await reconcileSession(session.session_id);
    setSession(updated);
    void refreshData();
  };

  const spendPercent = session?.policy?.max_session_spend
    ? Math.min(100, Math.round((session.total_active_spend / session.policy.max_session_spend) * 100))
    : 0;

  const isRazorpayActive = systemHealth?.provider === 'razorpay' || systemHealth?.razorpay_configured;

  return (
    <div className="min-h-screen bg-[#000000] text-[#ededed] flex flex-col font-mono selection:bg-white selection:text-black">
      {/* 01. Top Monochromatic Control Strip */}
      <header className="border-b border-[#1f1f23] bg-[#050505] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* System Identifier */}
            <div className="flex items-center gap-2.5">
              <div className="w-4 h-4 bg-white text-black flex items-center justify-center font-bold text-[10px]">
                ■
              </div>
              <span className="font-bold text-sm tracking-wider text-white">AGENTSHIELD</span>
              <span className="text-[10px] text-zinc-500 border border-zinc-800 px-1.5 py-0.5 rounded">
                KERNEL v1.0
              </span>
            </div>

            <div className="hidden lg:flex items-center gap-3 pl-4 border-l border-zinc-800 text-[11px] text-zinc-400">
              <span>BOUNDS: DETERMINISTIC_FIRST</span>
              <span className="text-zinc-700">|</span>
              <span>RAILS: {isRazorpayActive ? 'RAZORPAY_SANDBOX' : 'MOCK_SANDBOX'}</span>
              <span className="text-zinc-700">|</span>
              <span>MODEL: {systemHealth?.model?.replace('meta/', '') || 'llama-3.1-8b'}</span>
            </div>
          </div>

          {/* Session Switcher Pill */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 text-[11px]">SESSION_ID:</span>
            <div className="flex items-center bg-[#09090b] border border-zinc-800 px-2.5 py-1 rounded">
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="bg-transparent text-white font-mono text-xs w-32 focus:outline-none border-none p-0"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Precision Body */}
      <main className="max-w-7xl mx-auto px-6 py-6 flex-1 w-full space-y-6">
        {/* 02. Precision Boundaries Matrix (4 Modules) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Module 1: Session Spend */}
          <div className="kernel-panel p-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="text-zinc-500">01 // ACTIVE_SPEND</span>
              <span>{spendPercent}%</span>
            </div>
            <div className="text-xl font-bold text-white tracking-tight">
              ₹{session?.total_active_spend.toLocaleString() ?? '0'}
            </div>
            <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  spendPercent > 90 ? 'bg-rose-500' : spendPercent > 70 ? 'bg-amber-400' : 'bg-white'
                }`}
                style={{ width: `${spendPercent}%` }}
              />
            </div>
            <div className="text-[10px] text-zinc-500 flex justify-between">
              <span>Cap: ₹{session?.policy?.max_session_spend?.toLocaleString() ?? '10,000'}</span>
              <span>Reserved: ₹{session?.reserved_spend.toLocaleString() ?? '0'}</span>
            </div>
          </div>

          {/* Module 2: Intent Scope */}
          <div className="kernel-panel p-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="text-zinc-500">02 // INTENT_SCOPE</span>
              <span className="text-white">STRICT</span>
            </div>
            <div className="text-sm font-bold text-white truncate">
              {session?.intent?.category || 'footwear'}
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              Purpose: {session?.intent?.purpose || 'running shoes'}
            </div>
            <div className="text-[10px] text-zinc-500">
              Max Transaction: ₹{session?.policy?.max_transaction_amount?.toLocaleString() ?? '5,000'}
            </div>
          </div>

          {/* Module 3: Human Review Threshold */}
          <div className="kernel-panel p-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="text-zinc-500">03 // OPERATOR_GATE</span>
              <span className="text-amber-400">REVIEW</span>
            </div>
            <div className="text-xl font-bold text-amber-300">
              {session?.policy?.require_approval_above ? `> ₹${session.policy.require_approval_above.toLocaleString()}` : 'DISABLED'}
            </div>
            <div className="text-[10px] text-zinc-500">
              Orders exceeding ₹3k hold in PENDING
            </div>
          </div>

          {/* Module 4: Velocity Limiter */}
          <div className="kernel-panel p-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="text-zinc-500">04 // RATE_LIMIT</span>
              <span className="text-zinc-300">SLIDING_WINDOW</span>
            </div>
            <div className="text-xl font-bold text-white">
              {session?.policy?.max_requests_per_window ?? 4} <span className="text-xs font-normal text-zinc-500">req / 60s</span>
            </div>
            <div className="text-[10px] text-zinc-500">
              Window Burst Cap: ₹{session?.policy?.max_spend_per_window?.toLocaleString() ?? '10,000'}
            </div>
          </div>
        </section>

        {/* Pending Operator Authorization Queue (If Any) */}
        {pendingApprovals.length > 0 && (
          <section className="border border-amber-500/40 bg-amber-500/[0.04] p-5 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-300 tracking-wider uppercase">
                  Operator Authorization Required ({pendingApprovals.length} In-Flight)
                </span>
              </div>
              <span className="text-[11px] text-zinc-500 font-mono">STATE: PENDING_SIGNOFF</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingApprovals.map((appr) => (
                <div
                  key={appr.approval_id}
                  className="p-4 rounded-lg bg-[#000000] border border-zinc-800 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-zinc-500 text-[11px]">
                      <span className="text-amber-400 font-semibold">{appr.tool_name}()</span>
                      <span>{appr.approval_id}</span>
                    </div>
                    <div className="text-base font-bold text-white">
                      ₹{appr.amount?.toLocaleString() ?? 0} {appr.currency}
                    </div>
                    <div className="text-zinc-400 text-[11px]">
                      Args: {JSON.stringify(appr.arguments)}
                    </div>
                    <div className="text-amber-400 text-[11px]">
                      Trigger: {appr.reasons.join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-900">
                    <button
                      onClick={() => handleApprove(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-white hover:bg-zinc-200 text-black font-bold py-1.5 px-3 rounded text-xs transition"
                    >
                      Authorize & Dispatch
                    </button>
                    <button
                      onClick={() => handleReject(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 font-medium py-1.5 px-3 rounded text-xs transition"
                    >
                      Reject & Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 03. Operational Mode Switcher (Tactile Segmented Bar) */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-3 text-xs">
          <button
            onClick={() => setViewMode('interceptor')}
            className={`px-3.5 py-1.5 rounded transition ${
              viewMode === 'interceptor'
                ? 'bg-zinc-800 text-white font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            [01] Natural Language Interceptor
          </button>

          <button
            onClick={() => setViewMode('razorpay')}
            className={`px-3.5 py-1.5 rounded transition ${
              viewMode === 'razorpay'
                ? 'bg-zinc-800 text-white font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            [02] Direct Razorpay Console
          </button>

          <button
            onClick={() => setViewMode('attacks')}
            className={`px-3.5 py-1.5 rounded transition ${
              viewMode === 'attacks'
                ? 'bg-zinc-800 text-white font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            [03] Adversarial Test Matrix
          </button>

          <button
            onClick={() => setViewMode('audit')}
            className={`px-3.5 py-1.5 rounded transition ${
              viewMode === 'audit'
                ? 'bg-zinc-800 text-white font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            [04] Audit Ledger ({auditEvents.length})
          </button>
        </div>

        {/* 04. Mode 1: Natural Language Interceptor */}
        {viewMode === 'interceptor' && (
          <section className="space-y-6">
            {/* Terminal Style Prompt Input */}
            <div className="kernel-panel p-5 space-y-4">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="text-white font-bold flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                  AGENT_REQUEST_TERMINAL
                </span>
                <span className="text-zinc-500 text-[11px]">
                  Boundary: footwear // max=₹5,000 // gate=&gt;₹3,000
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAgentRun()}
                    placeholder="Enter natural language instruction for autonomous agent..."
                    className="w-full kernel-input px-4 py-2.5 text-xs text-white placeholder:text-zinc-600 pr-8"
                  />
                  {agentPrompt && (
                    <button
                      onClick={() => setAgentPrompt('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleAgentRun()}
                  disabled={loading || !agentPrompt.trim()}
                  className="kernel-btn px-4 py-2.5 text-xs flex items-center gap-2 shrink-0 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  {loading ? 'EVALUATING...' : 'EXECUTE'}
                </button>
              </div>

              {/* Quick Preset Payloads */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] pt-1">
                <span className="text-zinc-500">Inject:</span>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹1,500');
                    void handleAgentRun('Buy running shoes for ₹1,500');
                  }}
                  className="px-2 py-1 rounded bg-[#121215] border border-zinc-800 text-zinc-300 hover:border-zinc-600 transition"
                >
                  Valid Order (₹1,500)
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy ₹4,999 Amazon gift card');
                    void handleAgentRun('Buy ₹4,999 Amazon gift card');
                  }}
                  className="px-2 py-1 rounded bg-[#121215] border border-zinc-800 text-rose-300 hover:border-rose-700 transition"
                >
                  Prompt Injection: Gift Card (₹4,999)
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹4,500');
                    void handleAgentRun('Buy running shoes for ₹4,500');
                  }}
                  className="px-2 py-1 rounded bg-[#121215] border border-zinc-800 text-amber-300 hover:border-amber-700 transition"
                >
                  High-Value Review (₹4,500)
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Payout ₹8,000 to merchant');
                    void handleAgentRun('Payout ₹8,000 to merchant');
                  }}
                  className="px-2 py-1 rounded bg-[#121215] border border-zinc-800 text-rose-300 hover:border-rose-700 transition"
                >
                  Restricted Tool: create_payout
                </button>
              </div>
            </div>

            {/* Execution Trace State Machine */}
            {lastResult && (
              <div className="kernel-panel p-5 space-y-5">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500 uppercase">KERNEL_DECISION</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    }`}>
                      {lastResult.decision || lastResult.execution?.decision || 'EVALUATED'}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500">
                    TXN: {lastResult.execution?.transaction_id || 'NONE'}
                  </span>
                </div>

                {/* 4 Steps Monochromatic Pipeline */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                  {/* Step 1 */}
                  <div className="p-3 rounded bg-[#000000] border border-zinc-800 space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase">01 // USER_INTENT</div>
                    <div className="text-white truncate">"{lastResult.user_prompt || agentPrompt}"</div>
                    <div className="text-zinc-500 text-[11px]">Category: {session?.intent?.category || 'footwear'}</div>
                  </div>

                  {/* Step 2 */}
                  <div className="p-3 rounded bg-[#000000] border border-zinc-800 space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase">02 // NIM_PROPOSAL</div>
                    <div className="text-white truncate font-bold">
                      {lastResult.proposed_tool_name || lastResult.execution?.tool_name || 'create_order'}()
                    </div>
                    <div className="text-zinc-500 text-[11px]">
                      Amt: ₹{lastResult.proposed_arguments?.amount || lastResult.execution?.arguments?.amount || '—'}
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="p-3 rounded bg-[#000000] border border-zinc-800 space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase">03 // DETERMINISTIC_GUARD</div>
                    <div className="text-white font-bold">
                      Risk: {lastResult.execution?.risk_level || lastResult.risk_level || 'LOW'}
                    </div>
                    <div className="text-zinc-400 text-[11px] truncate">
                      {lastResult.execution?.reasons?.length > 0
                        ? lastResult.execution.reasons.join(', ')
                        : 'Bounds & Policy Passed'}
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="p-3 rounded bg-[#000000] border border-zinc-800 space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase">04 // PAYMENT_RAILS</div>
                    {lastResult.execution?.provider_result?.order || lastResult.provider_result?.order ? (
                      <div className="text-emerald-400 font-bold truncate">
                        {lastResult.execution?.provider_result?.order?.id || lastResult.provider_result?.order?.id}
                      </div>
                    ) : lastResult.execution?.decision === 'REVIEW' || lastResult.decision === 'REVIEW' ? (
                      <div className="text-amber-400">Held for Sign-off</div>
                    ) : (
                      <div className="text-rose-400">Execution Halted</div>
                    )}
                    <div className="text-zinc-500 text-[11px]">
                      {lastResult.execution?.provider_result?.order ? 'Settled on Razorpay' : 'Provider Guarded'}
                    </div>
                  </div>
                </div>

                {/* Evidence Details */}
                <div className="p-3 rounded bg-[#000000] border border-zinc-800 text-xs space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase font-bold">DECISION_EXPLANATION</div>
                  <p className="text-zinc-300 leading-relaxed m-0 font-sans">
                    {lastResult.execution?.policy_violations?.length > 0
                      ? `Policy Violation Detected: ${lastResult.execution.policy_violations.map((v: any) => `${v.rule} (Limit: ${v.limit}, Actual: ${v.actual})`).join(', ')}`
                      : lastResult.execution?.reasons?.length > 0
                      ? `Interception Reason: ${lastResult.execution.reasons.join(', ')}`
                      : 'Operation verified compliant with authorized scope, category, purpose, and sliding-window limits.'}
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 05. Mode 2: Direct Razorpay Console */}
        {viewMode === 'razorpay' && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Direct Order Form */}
              <div className="lg:col-span-2 kernel-panel p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase">DIRECT_RAZORPAY_DISPATCH</h3>
                    <p className="text-[11px] text-zinc-500 m-0">Create orders directly on Razorpay Test Rails through AgentShield</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                    INR // PAISE
                  </span>
                </div>

                <form onSubmit={handleDirectRazorpayOrder} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-zinc-400 mb-1 text-[11px]">AMOUNT (INR ₹)</label>
                      <input
                        type="number"
                        value={rzpAmount}
                        onChange={(e) => setRzpAmount(e.target.value)}
                        required
                        className="w-full kernel-input px-3 py-2 text-xs text-white"
                        placeholder="1500"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Converts to {(parseInt(rzpAmount || '0', 10) * 100).toLocaleString()} paise
                      </span>
                    </div>

                    <div>
                      <label className="block text-zinc-400 mb-1 text-[11px]">CATEGORY</label>
                      <input
                        type="text"
                        value={rzpCategory}
                        onChange={(e) => setRzpCategory(e.target.value)}
                        required
                        className="w-full kernel-input px-3 py-2 text-xs text-white"
                        placeholder="footwear"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block">
                        Authorized: footwear
                      </span>
                    </div>

                    <div>
                      <label className="block text-zinc-400 mb-1 text-[11px]">PURPOSE</label>
                      <input
                        type="text"
                        value={rzpPurpose}
                        onChange={(e) => setRzpPurpose(e.target.value)}
                        required
                        className="w-full kernel-input px-3 py-2 text-xs text-white"
                        placeholder="running shoes"
                      />
                    </div>

                    <div>
                      <label className="block text-zinc-400 mb-1 text-[11px]">RECEIPT_ID</label>
                      <input
                        type="text"
                        value={rzpReceipt}
                        onChange={(e) => setRzpReceipt(e.target.value)}
                        className="w-full kernel-input px-3 py-2 text-xs text-white"
                        placeholder="rcpt_1001"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">
                      Evaluates policy & intent before dispatch
                    </span>
                    <button
                      type="submit"
                      disabled={loading}
                      className="kernel-btn px-5 py-2 text-xs disabled:opacity-40"
                    >
                      DISPATCH_ORDER
                    </button>
                  </div>
                </form>
              </div>

              {/* Order Verifier */}
              <div className="kernel-panel p-5 space-y-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase mb-1">VERIFY_RAZORPAY_ORDER</h3>
                  <p className="text-[11px] text-zinc-500 mb-3">Query Razorpay Test API by order identifier.</p>

                  <form onSubmit={handleLookupOrder} className="space-y-3">
                    <input
                      type="text"
                      value={rzpLookupId}
                      onChange={(e) => setRzpLookupId(e.target.value)}
                      placeholder="order_..."
                      className="w-full kernel-input px-3 py-2 text-xs text-white"
                    />
                    <button
                      type="submit"
                      disabled={lookupLoading || !rzpLookupId.trim()}
                      className="w-full kernel-btn-secondary py-2 text-xs font-bold"
                    >
                      FETCH_STATUS
                    </button>
                  </form>

                  {lookupResult && (
                    <div className="mt-3 p-3 rounded bg-[#000000] border border-zinc-800 text-[11px] space-y-1">
                      <div className="text-zinc-500">PAYLOAD:</div>
                      <pre className="text-zinc-300 overflow-x-auto m-0">
                        {JSON.stringify(lookupResult.provider_result || lookupResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-zinc-800 text-[11px] text-zinc-500 space-y-1">
                  <div className="flex justify-between">
                    <span>MODE:</span>
                    <span className="text-zinc-300 font-bold">{isRazorpayActive ? 'RAZORPAY_TEST' : 'MOCK'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ENDPOINT:</span>
                    <span className="text-zinc-400">api.razorpay.com/v1</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 06. Mode 3: Adversarial Test Matrix */}
        {viewMode === 'attacks' && (
          <section className="space-y-4">
            <div className="text-xs">
              <h3 className="text-sm font-bold text-white uppercase">ADVERSARIAL_TEST_MATRIX</h3>
              <p className="text-zinc-500">Inject structured attack vectors to verify fail-closed kernel boundaries.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {/* Attack 1 */}
              <div className="kernel-panel p-4 flex flex-col justify-between space-y-3 border-rose-900/40">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-rose-400 font-bold text-[10px]">VECTOR // 01</span>
                  </div>
                  <h4 className="font-bold text-white">Category Injection</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Agent attempts to buy a ₹4,999 Gift Card instead of running shoes.
                  </p>
                </div>
                <button
                  onClick={() =>
                    void handleScenarioRun('create_order', {
                      amount: 4999,
                      category: 'gift_card',
                      purpose: 'digital gift card',
                    })
                  }
                  disabled={loading}
                  className="w-full kernel-btn-secondary py-1.5 text-xs text-rose-300 hover:border-rose-700"
                >
                  RUN_VECTOR
                </button>
              </div>

              {/* Attack 2 */}
              <div className="kernel-panel p-4 flex flex-col justify-between space-y-3 border-amber-900/40">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-400 font-bold text-[10px]">VECTOR // 02</span>
                  </div>
                  <h4 className="font-bold text-white">Threshold Breach</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    ₹3,500 order exceeds ₹3,000 threshold. Holds in PENDING state.
                  </p>
                </div>
                <button
                  onClick={() =>
                    void handleScenarioRun('create_order', {
                      amount: 3500,
                      category: 'footwear',
                      purpose: 'running shoes',
                    })
                  }
                  disabled={loading}
                  className="w-full kernel-btn-secondary py-1.5 text-xs text-amber-300 hover:border-amber-700"
                >
                  RUN_VECTOR
                </button>
              </div>

              {/* Attack 3 */}
              <div className="kernel-panel p-4 flex flex-col justify-between space-y-3 border-rose-900/40">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-rose-400 font-bold text-[10px]">VECTOR // 03</span>
                  </div>
                  <h4 className="font-bold text-white">Aggregate Overrun</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Attempt ₹8,000 order. Multiple allowed purchases breach ₹10k cap.
                  </p>
                </div>
                <button
                  onClick={() =>
                    void handleScenarioRun('create_order', {
                      amount: 8000,
                      category: 'footwear',
                      purpose: 'running shoes',
                    })
                  }
                  disabled={loading}
                  className="w-full kernel-btn-secondary py-1.5 text-xs text-rose-300 hover:border-rose-700"
                >
                  RUN_VECTOR
                </button>
              </div>

              {/* Attack 4 */}
              <div className="kernel-panel p-4 flex flex-col justify-between space-y-3 border-purple-900/40">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-purple-400 font-bold text-[10px]">VECTOR // 04</span>
                  </div>
                  <h4 className="font-bold text-white">Frequency Burst</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Fire 5 consecutive orders rapidly. Violates rate limit (4 req/60s).
                  </p>
                </div>
                <button
                  onClick={() => void handleVelocityBurst()}
                  disabled={loading}
                  className="w-full kernel-btn-secondary py-1.5 text-xs text-purple-300 hover:border-purple-700"
                >
                  RUN_VECTOR
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 07. Mode 4: Tamper-Evident Audit Ledger */}
        {viewMode === 'audit' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between text-xs">
              <div>
                <h3 className="text-sm font-bold text-white uppercase">AUDIT_LOG_LEDGER</h3>
                <p className="text-zinc-500 m-0">Permanent log of every intercepted tool call and security decision.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleResetSpend}
                  className="kernel-btn-secondary px-3 py-1 text-xs flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3 h-3" />
                  RESET_SPEND
                </button>
                <button
                  onClick={handleReconcile}
                  className="kernel-btn-secondary px-3 py-1 text-xs flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  RECONCILE
                </button>
              </div>
            </div>

            <div className="rounded border border-zinc-800 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#09090b] text-zinc-400 border-b border-zinc-800 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-4">TIMESTAMP</th>
                    <th className="py-2.5 px-4">DECISION</th>
                    <th className="py-2.5 px-4">RISK</th>
                    <th className="py-2.5 px-4">TOOL</th>
                    <th className="py-2.5 px-4">EVIDENCE</th>
                    <th className="py-2.5 px-4">TXN_ID</th>
                    <th className="py-2.5 px-4 text-right">INSPECT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 bg-[#000000]">
                  {auditEvents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-600 font-sans">
                        No audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditEvents.map((event) => (
                      <tr
                        key={event.event_id}
                        onClick={() => setSelectedEvent(event)}
                        className="hover:bg-zinc-950 transition cursor-pointer"
                      >
                        <td className="py-2.5 px-4 text-zinc-500 whitespace-nowrap">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              event.decision === 'ALLOW'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : event.decision === 'REVIEW'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {event.decision}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap text-zinc-300">
                          {event.risk_level || 'LOW'} ({event.risk_score.toFixed(2)})
                        </td>
                        <td className="py-2.5 px-4 text-white">
                          {event.tool_name}
                        </td>
                        <td className="py-2.5 px-4 text-zinc-400 text-xs font-sans">
                          {event.reasons.length > 0 ? (
                            <span className="text-rose-400">{event.reasons.join(', ')}</span>
                          ) : (
                            <span className="text-emerald-400">Compliant</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-zinc-500 whitespace-nowrap text-[11px]">
                          {event.transaction_id || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(event);
                            }}
                            className="p-1 text-zinc-500 hover:text-white"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* Raw Event Detail Drawer */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#09090b] border border-zinc-800 rounded-lg w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-[#000000]">
              <div className="text-xs">
                <span className="text-zinc-500">EVENT_ID: </span>
                <span className="text-white font-bold">{selectedEvent.event_id}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(selectedEvent, null, 2))}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white text-xs flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  {copiedText ? 'COPIED' : 'COPY'}
                </button>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-1 text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 bg-[#000000] p-3 rounded border border-zinc-900">
                <div><span className="text-zinc-500">DECISION:</span> <span className="text-white font-bold">{selectedEvent.decision}</span></div>
                <div><span className="text-zinc-500">RISK:</span> <span className="text-white font-bold">{selectedEvent.risk_level} ({selectedEvent.risk_score})</span></div>
                <div><span className="text-zinc-500">SESSION:</span> <span className="text-zinc-300">{selectedEvent.session_id}</span></div>
                <div><span className="text-zinc-500">TIME:</span> <span className="text-zinc-300">{selectedEvent.timestamp}</span></div>
              </div>

              <div>
                <div className="text-zinc-500 text-[10px] uppercase font-bold mb-1">RAW_PAYLOAD</div>
                <pre className="bg-[#000000] p-3 rounded border border-zinc-900 text-zinc-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Monochromatic Footer */}
      <footer className="border-t border-[#1f1f23] px-6 py-4 text-center text-[11px] text-zinc-600 mt-auto bg-[#000000]">
        AGENTSHIELD // THE AGENT MAY REQUEST AN ACTION. THE AGENT NEVER AUTHORIZES ITS OWN ACTION.
      </footer>
    </div>
  );
}
