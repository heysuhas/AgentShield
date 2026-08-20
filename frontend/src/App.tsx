import React, { useCallback, useEffect, useState } from 'react';
import {
  Shield,
  Activity,
  RotateCcw,
  RefreshCw,
  CreditCard,
  Layers,
  ChevronRight,
  UserCheck,
  Lock,
  Cpu,
  Check,
  X,
  Send,
  Bot,
  Sliders,
  Terminal,
  AlertOctagon,
  Copy,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert
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

type Tab = 'agent' | 'razorpay' | 'scenarios' | 'audit';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('agent');
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
    <div className="min-h-screen bg-[#06080d] text-[#f1f5f9] flex flex-col font-sans selection:bg-sky-500/30 selection:text-sky-200 antialiased">
      {/* Top Floating Glass Navigation Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#06080d]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Fluid Logo */}
            <div className="relative group flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500/20 via-indigo-500/20 to-teal-500/20 border border-sky-400/30 flex items-center justify-center shadow-[0_0_15px_rgba(14,165,233,0.25)] group-hover:scale-105 transition duration-300">
                <Shield className="w-4 h-4 text-sky-400" />
              </div>
              <div>
                <span className="font-bold text-sm tracking-tight text-white block leading-tight">AgentShield</span>
                <span className="text-[10px] font-mono text-zinc-400 block leading-tight">Razorpay AI Risk Layer</span>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2 pl-4 border-l border-white/[0.08] text-xs font-mono text-zinc-400">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                DETERMINISTIC BOUNDS ACTIVE
              </span>
            </div>
          </div>

          {/* Right Live Gateway Status Indicators */}
          <div className="flex items-center gap-2.5 text-xs font-mono">
            {/* Gateway Pill */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-white/[0.08] text-zinc-300 hover:border-white/[0.15] transition">
              <CreditCard className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-zinc-400">Rails:</span>
              <span className="text-white font-medium">
                {isRazorpayActive ? 'Razorpay Sandbox' : 'Sandbox (Mock)'}
              </span>
            </div>

            {/* Model Pill */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-white/[0.08] text-zinc-300 hover:border-white/[0.15] transition">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-zinc-400">NIM:</span>
              <span className="text-white font-medium">
                {systemHealth?.model?.replace('meta/', '') || 'llama-3.1-8b'}
              </span>
            </div>

            {/* Session Pill */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-white/[0.08]">
              <span className="text-zinc-500">Session:</span>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="bg-transparent text-white font-mono text-xs w-28 focus:outline-none focus:text-sky-300 border-none p-0"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-8 flex-1 w-full space-y-8">
        {/* Fluid Hero & Live Spend Dashboard */}
        <section className="relative overflow-hidden rounded-3xl fluid-card p-8 border border-white/[0.1]">
          {/* Subtle Ambient Radial Glows */}
          <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 rounded-full bg-sky-500/[0.07] blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/4 -mb-20 w-72 h-72 rounded-full bg-indigo-500/[0.05] blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="space-y-3 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-400/25 text-sky-300 text-xs font-mono font-medium">
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span>The Authorization & Risk Layer Between AI and Money</span>
              </div>

              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
                AI Agents Request Actions. <br />
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-teal-300 to-indigo-300">
                  AgentShield Authorizes Money.
                </span>
              </h1>

              <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                Autonomous agents never reach payment infrastructure directly. Every tool call passes through deterministic policy boundaries, semantic intent checks, and operator review gates.
              </p>
            </div>

            {/* Fluid Spend & Policy Metric Cards */}
            <div className="grid grid-cols-2 gap-3.5 w-full lg:w-auto shrink-0 font-mono text-xs">
              <div className="fluid-card p-5 rounded-2xl border border-white/[0.08] min-w-48 space-y-2">
                <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-sky-400" />
                    Session Spend
                  </span>
                  <span className="text-zinc-500">{spendPercent}%</span>
                </div>
                <div className="text-2xl font-bold text-white tracking-tight">
                  ₹{session?.total_active_spend.toLocaleString() ?? '0'}
                </div>
                <div className="w-full bg-zinc-800/80 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      spendPercent > 90
                        ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                        : spendPercent > 70
                        ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                        : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                    }`}
                    style={{ width: `${spendPercent}%` }}
                  />
                </div>
                <div className="text-[10px] text-zinc-500 flex justify-between pt-0.5">
                  <span>Committed: ₹{session?.committed_spend.toLocaleString() ?? 0}</span>
                  <span>Cap: ₹{session?.policy?.max_session_spend?.toLocaleString() ?? '10k'}</span>
                </div>
              </div>

              <div className="fluid-card p-5 rounded-2xl border border-white/[0.08] min-w-48 space-y-2">
                <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    Review Gate
                  </span>
                  <span className="text-amber-400 font-bold">P1</span>
                </div>
                <div className="text-2xl font-bold text-amber-300 tracking-tight">
                  {session?.policy?.require_approval_above ? `> ₹${session.policy.require_approval_above.toLocaleString()}` : 'None'}
                </div>
                <div className="text-[11px] text-zinc-400 pt-1">
                  Sliding Window: {session?.policy?.max_requests_per_window ?? 4} req / {session?.policy?.window_seconds ?? 60}s
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pending Human Authorization Queue (Fluid Banner) */}
        {pendingApprovals.length > 0 && (
          <section className="fluid-card p-6 rounded-3xl border border-amber-500/40 bg-gradient-to-r from-amber-950/20 via-zinc-900/90 to-amber-950/20 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-amber-200 m-0">
                    Human Review Required ({pendingApprovals.length} Transaction{pendingApprovals.length > 1 ? 's' : ''} Held)
                  </h3>
                  <p className="text-xs text-zinc-400 m-0">
                    Spend is atomically reserved in PENDING status. Payment rails will not execute until an operator authorizes.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
              {pendingApprovals.map((appr) => (
                <div
                  key={appr.approval_id}
                  className="p-4 rounded-2xl bg-zinc-950/90 border border-amber-500/30 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1 text-xs font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-amber-400 font-bold px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-[10px]">
                        REVIEW REQUIRED
                      </span>
                      <span className="text-zinc-500 text-[11px]">{appr.approval_id}</span>
                    </div>
                    <div className="text-sm font-semibold text-white pt-1">
                      {appr.tool_name} — ₹{appr.amount?.toLocaleString() ?? 0} {appr.currency}
                    </div>
                    <div className="text-zinc-400 text-[11px]">
                      Args: {JSON.stringify(appr.arguments)}
                    </div>
                    <div className="text-amber-300 text-[11px]">
                      Reason: {appr.reasons.join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/80">
                    <button
                      onClick={() => handleApprove(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-3 rounded-xl text-xs transition flex items-center justify-center gap-1.5 shadow-md"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Authorize & Dispatch
                    </button>
                    <button
                      onClick={() => handleReject(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-zinc-800 hover:bg-zinc-750 text-zinc-200 font-medium py-2 px-3 rounded-xl text-xs transition flex items-center justify-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject & Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Fluid Pill Tabs */}
        <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl bg-zinc-900/60 border border-white/[0.06] w-fit">
          <button
            onClick={() => setActiveTab('agent')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition duration-200 ${
              activeTab === 'agent'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Bot className="w-4 h-4 text-sky-400" />
            Agent Guardrail Stream
          </button>

          <button
            onClick={() => setActiveTab('razorpay')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition duration-200 ${
              activeTab === 'razorpay'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <CreditCard className="w-4 h-4 text-indigo-400" />
            Direct Razorpay Console
          </button>

          <button
            onClick={() => setActiveTab('scenarios')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition duration-200 ${
              activeTab === 'scenarios'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Sliders className="w-4 h-4 text-amber-400" />
            Security Attack Lab
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition duration-200 ${
              activeTab === 'audit'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
            }`}
          >
            <Layers className="w-4 h-4 text-teal-400" />
            Audit Ledger ({auditEvents.length})
          </button>
        </div>

        {/* Tab 1: Agent Guardrail Stream */}
        {activeTab === 'agent' && (
          <section className="space-y-6">
            {/* Fluid Prompt Command Console */}
            <div className="fluid-card p-6 rounded-3xl border border-white/[0.1] space-y-4">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-sky-400" />
                  Natural Language Agent Prompt
                </label>
                <span className="font-mono text-zinc-400 text-[11px]">
                  Active Boundary: category=footwear · max=₹5,000 · review=&gt;₹3,000
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAgentRun()}
                    placeholder="Ask the AI agent (e.g. 'Buy running shoes under ₹5,000')..."
                    className="w-full fluid-input px-4 py-3 text-sm font-mono placeholder:text-zinc-600 pr-10"
                  />
                  {agentPrompt && (
                    <button
                      onClick={() => setAgentPrompt('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleAgentRun()}
                  disabled={loading || !agentPrompt.trim()}
                  className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold px-5 py-3 rounded-2xl text-xs transition flex items-center gap-2 shrink-0 shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {loading ? 'Evaluating...' : 'Dispatch Agent'}
                </button>
              </div>

              {/* Sample Intent Prompt Chips */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-mono">
                <span className="text-zinc-500">Quick Presets:</span>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹1,500');
                    void handleAgentRun('Buy running shoes for ₹1,500');
                  }}
                  className="px-3 py-1 rounded-xl bg-zinc-900/80 border border-emerald-500/30 text-emerald-300 hover:bg-zinc-800 transition"
                >
                  ✓ Valid: Shoes ₹1,500
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy ₹4,999 Amazon gift card');
                    void handleAgentRun('Buy ₹4,999 Amazon gift card');
                  }}
                  className="px-3 py-1 rounded-xl bg-zinc-900/80 border border-rose-500/30 text-rose-300 hover:bg-zinc-800 transition"
                >
                  ✗ Prompt Injection: Gift Card ₹4,999
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹4,500');
                    void handleAgentRun('Buy running shoes for ₹4,500');
                  }}
                  className="px-3 py-1 rounded-xl bg-zinc-900/80 border border-amber-500/30 text-amber-300 hover:bg-zinc-800 transition"
                >
                  ⚠ High-Value: Shoes ₹4,500 (Review Gate)
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Payout ₹8,000 to merchant');
                    void handleAgentRun('Payout ₹8,000 to merchant');
                  }}
                  className="px-3 py-1 rounded-xl bg-zinc-900/80 border border-rose-500/30 text-rose-300 hover:bg-zinc-800 transition"
                >
                  ✗ Restricted Tool: create_payout
                </button>
              </div>
            </div>

            {/* Fluid 4-Step Animated Pipeline Trace */}
            {lastResult && (
              <div className="fluid-card p-7 rounded-3xl border border-white/[0.1] space-y-6">
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono uppercase text-zinc-500">Execution Result</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold ${
                      lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.2)]'
                    }`}>
                      {lastResult.decision || lastResult.execution?.decision || 'EVALUATED'}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-zinc-500">
                    Session: {sessionId}
                  </span>
                </div>

                {/* 4 Steps Horizontal Chain */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5 font-mono text-xs">
                  {/* Step 1: User Request */}
                  <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.08] space-y-2 relative overflow-hidden">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-bold uppercase text-sky-400">1. User Intent</span>
                      <Check className="w-3.5 h-3.5 text-sky-400" />
                    </div>
                    <div className="text-white font-sans text-xs truncate">
                      "{lastResult.user_prompt || agentPrompt}"
                    </div>
                    <div className="text-zinc-400 text-[11px]">
                      Intent: {session?.intent?.category || 'footwear'}
                    </div>
                  </div>

                  {/* Step 2: NIM Model Proposal */}
                  <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.08] space-y-2 relative overflow-hidden">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-bold uppercase text-indigo-400">2. NIM Proposal</span>
                      <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <div className="text-indigo-300 truncate font-semibold">
                      {lastResult.proposed_tool_name || lastResult.execution?.tool_name || 'create_order'}()
                    </div>
                    <div className="text-zinc-400 text-[11px]">
                      Amount: ₹{lastResult.proposed_arguments?.amount || lastResult.execution?.arguments?.amount || '—'}
                    </div>
                  </div>

                  {/* Step 3: AgentShield Guard */}
                  <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.08] space-y-2 relative overflow-hidden">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-bold uppercase text-purple-400">3. Shield Guard</span>
                      <Shield className="w-3.5 h-3.5 text-purple-400" />
                    </div>
                    <div className="text-white font-semibold">
                      Risk: {lastResult.execution?.risk_level || lastResult.risk_level || 'LOW'}
                    </div>
                    <div className="text-zinc-400 text-[11px] truncate">
                      {lastResult.execution?.reasons?.length > 0
                        ? lastResult.execution.reasons.join(', ')
                        : 'Bounds & Policy Passed'}
                    </div>
                  </div>

                  {/* Step 4: Razorpay Gateway */}
                  <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.08] space-y-2 relative overflow-hidden">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-bold uppercase text-emerald-400">4. Razorpay Sandbox</span>
                      <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    {lastResult.execution?.provider_result?.order || lastResult.provider_result?.order ? (
                      <div className="text-emerald-400 truncate font-semibold">
                        {lastResult.execution?.provider_result?.order?.id || lastResult.provider_result?.order?.id}
                      </div>
                    ) : lastResult.execution?.decision === 'REVIEW' || lastResult.decision === 'REVIEW' ? (
                      <div className="text-amber-400 font-semibold">
                        Held for Review
                      </div>
                    ) : (
                      <div className="text-rose-400 font-semibold">
                        Execution Blocked
                      </div>
                    )}
                    <div className="text-zinc-400 text-[11px]">
                      {lastResult.execution?.provider_result?.order ? 'Order Settled' : 'Provider Guarded'}
                    </div>
                  </div>
                </div>

                {/* Plain-English Explanation Banner */}
                <div className={`p-4 rounded-2xl border text-xs font-mono flex items-start gap-3.5 ${
                  lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}>
                  <div className="mt-0.5 shrink-0">
                    {lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW' ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    ) : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW' ? (
                      <Lock className="w-5 h-5 text-amber-400" />
                    ) : (
                      <AlertOctagon className="w-5 h-5 text-rose-400" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="font-bold text-sm">
                      {lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'ALLOW: Transaction authorized and dispatched to Razorpay.'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'REVIEW: Transaction requires human authorization.'
                        : 'BLOCK: Operation prevented by AgentShield boundary.'}
                    </div>
                    <p className="text-zinc-300 font-sans leading-relaxed m-0">
                      {lastResult.execution?.policy_violations?.length > 0
                        ? `Policy Violation: ${lastResult.execution.policy_violations.map((v: any) => `${v.rule} (Limit: ${v.limit}, Actual: ${v.actual})`).join(', ')}`
                        : lastResult.execution?.reasons?.length > 0
                        ? `Interception Reason: ${lastResult.execution.reasons.join(', ')}`
                        : 'Operation matches user authorized category, purpose, and maximum amount limit.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Direct Razorpay Gateway Console */}
        {activeTab === 'razorpay' && (
          <section className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Card 1: Direct Order Form */}
              <div className="lg:col-span-2 fluid-card p-7 rounded-3xl border border-white/[0.1] space-y-5">
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white">Direct Razorpay Sandbox Order Dispatch</h3>
                    <p className="text-xs text-zinc-400">Dispatch test orders directly to Razorpay through the AgentShield boundary</p>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400">
                    INR / Paise Subunits
                  </span>
                </div>

                <form onSubmit={handleDirectRazorpayOrder} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-mono">Amount (INR ₹)</label>
                      <input
                        type="number"
                        value={rzpAmount}
                        onChange={(e) => setRzpAmount(e.target.value)}
                        required
                        className="w-full fluid-input px-3.5 py-2.5 text-xs font-mono text-white"
                        placeholder="1500"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block font-mono">
                        Converts to {(parseInt(rzpAmount || '0', 10) * 100).toLocaleString()} paise on Razorpay
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-mono">Category</label>
                      <input
                        type="text"
                        value={rzpCategory}
                        onChange={(e) => setRzpCategory(e.target.value)}
                        required
                        className="w-full fluid-input px-3.5 py-2.5 text-xs font-mono text-white"
                        placeholder="footwear"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block font-mono">
                        Authorized: footwear
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-mono">Purpose</label>
                      <input
                        type="text"
                        value={rzpPurpose}
                        onChange={(e) => setRzpPurpose(e.target.value)}
                        required
                        className="w-full fluid-input px-3.5 py-2.5 text-xs font-mono text-white"
                        placeholder="running shoes"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-mono">Receipt ID</label>
                      <input
                        type="text"
                        value={rzpReceipt}
                        onChange={(e) => setRzpReceipt(e.target.value)}
                        className="w-full fluid-input px-3.5 py-2.5 text-xs font-mono text-white"
                        placeholder="rcpt_1001"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <div className="text-xs text-zinc-500 font-mono flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      Evaluates policy & intent before dispatch
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-white hover:bg-zinc-200 text-black font-semibold px-6 py-2.5 rounded-xl text-xs transition disabled:opacity-50 shadow-md"
                    >
                      Create Razorpay Order
                    </button>
                  </div>
                </form>
              </div>

              {/* Card 2: Razorpay Order Verifier */}
              <div className="fluid-card p-7 rounded-3xl border border-white/[0.1] space-y-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">Verify Razorpay Order</h3>
                  <p className="text-xs text-zinc-400 mb-4">
                    Query Razorpay Sandbox API to inspect settled order state.
                  </p>

                  <form onSubmit={handleLookupOrder} className="space-y-3">
                    <input
                      type="text"
                      value={rzpLookupId}
                      onChange={(e) => setRzpLookupId(e.target.value)}
                      placeholder="order_RzpTest123..."
                      className="w-full fluid-input px-3.5 py-2.5 text-xs font-mono text-white"
                    />
                    <button
                      type="submit"
                      disabled={lookupLoading || !rzpLookupId.trim()}
                      className="w-full bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-white py-2.5 rounded-xl text-xs font-semibold transition"
                    >
                      Fetch Order Status
                    </button>
                  </form>

                  {lookupResult && (
                    <div className="mt-3 p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-mono space-y-1">
                      <div className="text-zinc-400">Order Payload:</div>
                      <pre className="text-sky-300 overflow-x-auto m-0">
                        {JSON.stringify(lookupResult.provider_result || lookupResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-zinc-800 text-[11px] font-mono text-zinc-400 space-y-1.5">
                  <div className="flex justify-between">
                    <span>Provider Mode:</span>
                    <span className="text-white font-medium">
                      {isRazorpayActive ? 'Razorpay Sandbox' : 'Mock Provider'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>API Endpoint:</span>
                    <span className="text-zinc-300">api.razorpay.com/v1</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab 3: Security Attack Lab */}
        {activeTab === 'scenarios' && (
          <section className="space-y-6">
            <div>
              <h3 className="text-base font-bold text-white">Security & Attack Scenarios</h3>
              <p className="text-xs text-zinc-400">
                Demonstrates how AgentShield halts attacks that pass ordinary spending limits.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
              {/* Scenario 1: Prompt Injection */}
              <div className="fluid-card p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-rose-500/30">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-rose-400 font-bold px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-800 text-[10px]">
                      CATEGORY MISMATCH
                    </span>
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-white font-sans mb-1">1. Prompt Injection</h4>
                  <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                    Agent attempts to buy a ₹4,999 Gift Card instead of authorized running shoes.
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
                  className="w-full bg-rose-600/80 hover:bg-rose-500 text-white font-medium py-2 rounded-xl text-xs transition"
                >
                  Run Scenario
                </button>
              </div>

              {/* Scenario 2: High Value Review */}
              <div className="fluid-card p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-amber-500/30">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-amber-400 font-bold px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-[10px]">
                      REVIEW REQUIRED
                    </span>
                    <UserCheck className="w-4 h-4 text-amber-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-white font-sans mb-1">2. High-Value Order</h4>
                  <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                    ₹3,500 order exceeds ₹3,000 threshold. Holds in PENDING without calling Razorpay.
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
                  className="w-full bg-amber-600/80 hover:bg-amber-500 text-white font-medium py-2 rounded-xl text-xs transition"
                >
                  Run Scenario
                </button>
              </div>

              {/* Scenario 3: Aggregate Overrun */}
              <div className="fluid-card p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-rose-500/30">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-rose-400 font-bold px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-800 text-[10px]">
                      BUDGET OVERRUN
                    </span>
                    <Activity className="w-4 h-4 text-rose-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-white font-sans mb-1">3. Aggregate Overrun</h4>
                  <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                    Attempt ₹8,000 order. Multiple allowed purchases breach ₹10k session cap.
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
                  className="w-full bg-rose-600/80 hover:bg-rose-500 text-white font-medium py-2 rounded-xl text-xs transition"
                >
                  Run Scenario
                </button>
              </div>

              {/* Scenario 4: Velocity Burst */}
              <div className="fluid-card p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-purple-500/30">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-purple-400 font-bold px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-800 text-[10px]">
                      BURST LIMIT
                    </span>
                    <Clock className="w-4 h-4 text-purple-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-white font-sans mb-1">4. Velocity Burst</h4>
                  <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                    Fire 5 consecutive orders rapidly. Violates sliding-window limit (4 req/60s).
                  </p>
                </div>
                <button
                  onClick={() => void handleVelocityBurst()}
                  disabled={loading}
                  className="w-full bg-purple-600/80 hover:bg-purple-500 text-white font-medium py-2 rounded-xl text-xs transition"
                >
                  Run Scenario
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Tab 4: Audit Trail Table */}
        {activeTab === 'audit' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Security Audit Log</h3>
                <p className="text-xs text-zinc-400">
                  Tamper-evident record of all agent execution requests and policy decisions.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleResetSpend}
                  className="px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-mono transition flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Spend
                </button>
                <button
                  onClick={handleReconcile}
                  className="px-3.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-mono transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reconcile
                </button>
              </div>
            </div>

            <div className="rounded-2xl fluid-card overflow-hidden border border-white/[0.08]">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-950/80 text-zinc-400 border-b border-zinc-800/80 text-[11px]">
                  <tr>
                    <th className="py-3.5 px-4">Time</th>
                    <th className="py-3.5 px-4">Decision</th>
                    <th className="py-3.5 px-4">Risk</th>
                    <th className="py-3.5 px-4">Tool</th>
                    <th className="py-3.5 px-4">Reasons</th>
                    <th className="py-3.5 px-4">Transaction</th>
                    <th className="py-3.5 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {auditEvents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500 font-sans">
                        No audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditEvents.map((event) => (
                      <tr
                        key={event.event_id}
                        onClick={() => setSelectedEvent(event)}
                        className="hover:bg-zinc-900/40 transition cursor-pointer"
                      >
                        <td className="py-3.5 px-4 text-zinc-400 whitespace-nowrap">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              event.decision === 'ALLOW'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : event.decision === 'REVIEW'
                                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            {event.decision}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="text-zinc-300">
                            {event.risk_level || 'LOW'} ({event.risk_score.toFixed(2)})
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-zinc-200">
                          {event.tool_name}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-400 font-sans text-xs">
                          {event.reasons.length > 0 ? (
                            <span className="text-rose-400 font-medium">
                              {event.reasons.join(', ')}
                            </span>
                          ) : (
                            <span className="text-emerald-400">Valid</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-zinc-500 whitespace-nowrap text-[11px]">
                          {event.transaction_id || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(event);
                            }}
                            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
                          >
                            <ChevronRight className="w-4 h-4" />
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

      {/* Fluid JSON Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="fluid-card rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-white/[0.15]">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-zinc-500">Event:</span>
                <span className="text-white font-semibold">{selectedEvent.event_id}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(selectedEvent, null, 2))}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white text-xs flex items-center gap-1 font-mono transition"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedText ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3 bg-zinc-950/80 p-4 rounded-2xl border border-zinc-800">
                <div>
                  <span className="text-zinc-500">Decision:</span>{' '}
                  <span className={
                    selectedEvent.decision === 'ALLOW'
                      ? 'text-emerald-400 font-bold'
                      : selectedEvent.decision === 'REVIEW'
                      ? 'text-amber-400 font-bold'
                      : 'text-rose-400 font-bold'
                  }>
                    {selectedEvent.decision}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Risk Level:</span>{' '}
                  <span className="text-zinc-300 font-bold">{selectedEvent.risk_level} ({selectedEvent.risk_score})</span>
                </div>
                <div>
                  <span className="text-zinc-500">Session ID:</span>{' '}
                  <span className="text-zinc-300">{selectedEvent.session_id}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Timestamp:</span>{' '}
                  <span className="text-zinc-300">{selectedEvent.timestamp}</span>
                </div>
              </div>

              <div>
                <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-2 font-bold">Raw Audit Payload</div>
                <pre className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800/80 text-zinc-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/[0.06] px-6 py-5 text-center text-xs font-mono text-zinc-500 mt-auto">
        AgentShield · The agent may request an action. The agent never authorizes its own action.
      </footer>
    </div>
  );
}
