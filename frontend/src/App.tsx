import React, { useCallback, useEffect, useState } from 'react';
import {
  Shield,
  ShieldAlert,
  Zap,
  Activity,
  RotateCcw,
  RefreshCw,
  Play,
  FileText,
  CreditCard,
  Clock,
  Layers,
  ChevronRight,
  UserCheck,
  CheckCircle2,
  XCircle,
  Search,
  Sparkles,
  Lock,
  Cpu,
  Check,
  X,
  Send,
  Radio,
  Info,
  Bot
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
        fetchAuditEvents(sessionId, undefined, undefined, 40),
        fetchTransactions(sessionId, undefined, 40),
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
    <div className="min-h-screen text-slate-100 flex flex-col font-sans selection:bg-sky-500/30 selection:text-sky-200">
      {/* Top Navbar */}
      <nav className="glass-panel sticky top-0 z-50 border-b border-white/[0.08] px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Logo & Product Tag */}
          <div className="flex items-center gap-3.5">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20 border border-sky-500/30 shadow-[0_0_15px_rgba(14,165,233,0.3)]">
              <Shield className="w-5 h-5 text-sky-400" />
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-wider text-base text-white">AgentShield</span>
                <span className="text-[10px] uppercase font-mono tracking-widest px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/25">
                  Trust Layer
                </span>
              </div>
              <p className="text-[11px] text-slate-400 m-0">Authorization & Risk Boundary for AI Agents</p>
            </div>
          </div>

          {/* System Environment Status Badges */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
            {/* Razorpay Gateway Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-sky-500/30 text-sky-300">
              <CreditCard className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-slate-400">Gateway:</span>
              <span className="font-semibold text-white">
                {isRazorpayActive ? 'Razorpay Sandbox' : 'Razorpay / Mock Provider'}
              </span>
            </div>

            {/* Model Badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/[0.08] text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400">LLM:</span>
              <span className="font-semibold text-indigo-300">
                {systemHealth?.model?.replace('meta/', '') || 'Llama-3.1-8B NIM'}
              </span>
            </div>

            {/* Session Switcher Pill */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-white/[0.08]">
              <span className="text-slate-500">Session:</span>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="bg-transparent text-white font-mono text-xs w-28 focus:outline-hidden focus:text-sky-300 border-none p-0"
              />
            </div>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-6 flex-1 w-full space-y-7">
        {/* Glassmorphic Hero Banner with Mirror Reflection Effect */}
        <section className="relative overflow-hidden rounded-3xl glass-panel-glow p-8 md:p-10 border border-white/[0.12]">
          {/* Background illumination beams */}
          <div className="absolute top-0 right-0 -mt-10 -mr-10 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-1/3 -mb-10 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-400/30 text-sky-300 text-xs font-mono font-medium">
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span>Deterministic Bounds · Semantic Intent Verification · Razorpay Gateway</span>
              </div>

              {/* Blurry Mirror Reflection Typography */}
              <h1
                data-text="The Trust Layer Between AI and Money."
                className="mirror-text-glow text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-tight"
              >
                The Trust Layer Between <span className="bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-indigo-300 to-purple-400">AI and Money.</span>
              </h1>

              <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                Autonomous agents can propose financial transactions, but they never authorize themselves.
                Every sensitive tool call is intercepted, validated against user intent, policy limits, and human approval before reaching payment rails.
              </p>
            </div>

            {/* Quick Metrics Capsule */}
            <div className="grid grid-cols-2 gap-3 w-full md:w-auto shrink-0 font-mono text-xs">
              <div className="glass-card p-4 rounded-2xl border border-white/[0.08]">
                <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-sky-400" />
                  Active Spend
                </div>
                <div className="text-xl font-bold text-white">
                  ₹{session?.total_active_spend.toLocaleString() ?? '0'}
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      spendPercent > 90
                        ? 'bg-rose-500'
                        : spendPercent > 70
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${spendPercent}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Cap: ₹{session?.policy?.max_session_spend?.toLocaleString() ?? '10,000'}
                </div>
              </div>

              <div className="glass-card p-4 rounded-2xl border border-white/[0.08]">
                <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  Review Gate
                </div>
                <div className="text-xl font-bold text-amber-300">
                  {session?.policy?.require_approval_above ? `> ₹${session.policy.require_approval_above.toLocaleString()}` : 'None'}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Operator sign-off
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pending Human Approvals Alert Banner */}
        {pendingApprovals.length > 0 && (
          <section className="glass-panel p-5 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-950/30 via-slate-900/90 to-amber-950/20 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-amber-200 m-0">
                    Human Authorization Required ({pendingApprovals.length} In-Flight)
                  </h3>
                  <p className="text-xs text-slate-400 m-0">
                    Transaction held in PENDING state. Payment provider will not be executed until authorized.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {pendingApprovals.map((appr) => (
                <div
                  key={appr.approval_id}
                  className="p-4 rounded-xl bg-slate-950/80 border border-amber-500/30 flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="text-amber-400 font-bold bg-amber-950/80 px-2 py-0.5 rounded border border-amber-800/80">
                        REVIEW REQUIRED
                      </span>
                      <span className="text-slate-400">{appr.approval_id}</span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-white">
                      {appr.tool_name} — ₹{appr.amount?.toLocaleString() ?? 0} {appr.currency}
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      Args: {JSON.stringify(appr.arguments)}
                    </div>
                    <div className="text-xs text-amber-300 mt-1">
                      Reason: {appr.reasons.join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      onClick={() => handleApprove(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-1.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5 shadow-md"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Authorize & Dispatch
                    </button>
                    <button
                      onClick={() => handleReject(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-rose-600/80 hover:bg-rose-500 text-white font-medium py-1.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5"
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

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/[0.08] pb-1">
          <button
            onClick={() => setActiveTab('agent')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'agent'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Bot className="w-4 h-4 text-sky-400" />
            Agent Guardrail Stream
          </button>

          <button
            onClick={() => setActiveTab('razorpay')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'razorpay'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <CreditCard className="w-4 h-4 text-indigo-400" />
            Direct Razorpay Gateway
          </button>

          <button
            onClick={() => setActiveTab('scenarios')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'scenarios'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-400" />
            Attack & Scenario Lab
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'audit'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
            }`}
          >
            <Layers className="w-4 h-4 text-purple-400" />
            Audit Ledger ({auditEvents.length})
          </button>
        </div>

        {/* Tab 1: Agent Guardrail Stream */}
        {activeTab === 'agent' && (
          <section className="space-y-6">
            {/* Natural Language Prompt Input Console */}
            <div className="glass-panel p-6 rounded-3xl border border-white/[0.1] space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Bot className="w-4 h-4 text-sky-400" />
                  Ask the Autonomous Agent
                </label>
                <span className="text-[11px] text-slate-400 font-mono">
                  Intent Guard: footwear · running shoes · max ₹5,000
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAgentRun()}
                    placeholder="Enter instructions for the AI agent (e.g. 'Buy running shoes under ₹5,000')..."
                    className="w-full bg-slate-950/80 border border-white/[0.12] focus:border-sky-400 rounded-2xl px-4 py-3 text-sm text-white focus:outline-hidden font-mono placeholder:text-slate-500 pr-10"
                  />
                  {agentPrompt && (
                    <button
                      onClick={() => setAgentPrompt('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleAgentRun()}
                  disabled={loading || !agentPrompt.trim()}
                  className="bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold px-5 py-3 rounded-2xl text-xs transition flex items-center gap-2 shrink-0 shadow-[0_0_20px_rgba(14,165,233,0.3)] disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {loading ? 'Evaluating...' : 'Dispatch Agent'}
                </button>
              </div>

              {/* Sample Intent Prompt Chips */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-500">Quick Prompts:</span>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹1,500');
                    void handleAgentRun('Buy running shoes for ₹1,500');
                  }}
                  className="text-[11px] font-mono px-2.5 py-1 rounded-xl bg-slate-900 border border-emerald-500/30 text-emerald-300 hover:bg-slate-850 transition"
                >
                  ✓ Valid: Running Shoes ₹1,500
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy ₹4,999 Amazon gift card');
                    void handleAgentRun('Buy ₹4,999 Amazon gift card');
                  }}
                  className="text-[11px] font-mono px-2.5 py-1 rounded-xl bg-slate-900 border border-rose-500/30 text-rose-300 hover:bg-slate-850 transition"
                >
                  ✗ Attack: Gift Card ₹4,999
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹4,500');
                    void handleAgentRun('Buy running shoes for ₹4,500');
                  }}
                  className="text-[11px] font-mono px-2.5 py-1 rounded-xl bg-slate-900 border border-amber-500/30 text-amber-300 hover:bg-slate-850 transition"
                >
                  ⚠ High-Value: Shoes ₹4,500 (Review)
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Payout ₹8,000 to merchant');
                    void handleAgentRun('Payout ₹8,000 to merchant');
                  }}
                  className="text-[11px] font-mono px-2.5 py-1 rounded-xl bg-slate-900 border border-rose-500/30 text-rose-300 hover:bg-slate-850 transition"
                >
                  ✗ Disallowed Tool: create_payout
                </button>
              </div>
            </div>

            {/* Live 4-Step Animated Pipeline Trace */}
            {lastResult && (
              <div className="glass-panel p-6 rounded-3xl border border-white/[0.1] space-y-6">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 m-0">
                    <Radio className="w-4 h-4 text-sky-400" />
                    AgentShield Execution Trace
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold font-mono ${
                      lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'bg-amber-950 text-amber-400 border border-amber-800'
                        : 'bg-rose-950 text-rose-400 border border-rose-800'
                    }`}>
                      {lastResult.decision || lastResult.execution?.decision || 'EVALUATED'}
                    </span>
                  </div>
                </div>

                {/* 4 Steps Horizontal Chain */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
                  {/* Step 1: User Intent */}
                  <div className="glass-card p-4 rounded-2xl border border-white/[0.08] space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono uppercase font-bold text-sky-400">1. User Intent</span>
                      <Check className="w-3.5 h-3.5 text-sky-400" />
                    </div>
                    <div className="text-xs text-white font-medium">
                      "{lastResult.user_prompt || agentPrompt}"
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Category: {session?.intent?.category || 'footwear'}
                    </div>
                  </div>

                  {/* Step 2: NIM Model Proposal */}
                  <div className="glass-card p-4 rounded-2xl border border-white/[0.08] space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono uppercase font-bold text-indigo-400">2. NIM Proposal</span>
                      <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <div className="text-xs font-mono text-indigo-300">
                      {lastResult.proposed_tool_name || lastResult.execution?.tool_name || 'create_order'}()
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Amount: ₹{lastResult.proposed_arguments?.amount || lastResult.execution?.arguments?.amount || '—'}
                    </div>
                  </div>

                  {/* Step 3: AgentShield Guardrail */}
                  <div className="glass-card p-4 rounded-2xl border border-white/[0.08] space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono uppercase font-bold text-purple-400">3. Shield Guard</span>
                      <Shield className="w-3.5 h-3.5 text-purple-400" />
                    </div>
                    <div className="text-xs font-semibold text-white">
                      Risk Level: {lastResult.execution?.risk_level || lastResult.risk_level || 'LOW'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {lastResult.execution?.reasons?.length > 0
                        ? lastResult.execution.reasons.join(', ')
                        : 'Passed deterministic & semantic checks'}
                    </div>
                  </div>

                  {/* Step 4: Razorpay Sandbox Rails */}
                  <div className="glass-card p-4 rounded-2xl border border-white/[0.08] space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono uppercase font-bold text-emerald-400">4. Payment Gateway</span>
                      <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    {lastResult.execution?.provider_result?.order || lastResult.provider_result?.order ? (
                      <div>
                        <div className="text-xs font-mono text-emerald-300 font-semibold truncate">
                          {lastResult.execution?.provider_result?.order?.id || lastResult.provider_result?.order?.id}
                        </div>
                        <div className="text-[11px] text-emerald-400/80">
                          Razorpay Order Created
                        </div>
                      </div>
                    ) : lastResult.execution?.decision === 'REVIEW' || lastResult.decision === 'REVIEW' ? (
                      <div className="text-xs text-amber-300 font-mono">
                        Held for Operator Review
                      </div>
                    ) : (
                      <div className="text-xs text-rose-300 font-mono">
                        Provider Execution Blocked
                      </div>
                    )}
                  </div>
                </div>

                {/* Plain-English Decision Explanation */}
                <div className={`p-4 rounded-2xl border flex items-start gap-3 ${
                  lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'
                    : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                    ? 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                    : 'bg-rose-950/30 border-rose-500/30 text-rose-200'
                }`}>
                  <Info className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <div className="font-bold text-sm">
                      {lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'Operation Permitted: Dispatched to Razorpay Sandbox'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'Operation Held: Requires Operator Sign-off'
                        : 'Operation Disallowed: Security Boundary Triggered'}
                    </div>
                    <p className="text-slate-300 leading-relaxed m-0">
                      {lastResult.execution?.policy_violations?.length > 0
                        ? `Policy Violation: ${lastResult.execution.policy_violations.map((v: any) => `${v.rule} (Limit: ${v.limit}, Actual: ${v.actual})`).join(', ')}`
                        : lastResult.execution?.reasons?.length > 0
                        ? `Interception Reason: ${lastResult.execution.reasons.join(', ')}`
                        : 'Request conforms to user authorized category, purpose, amount ceiling, and sliding-window velocity bounds.'}
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Card 1: Direct Order Creation Form */}
              <div className="md:col-span-2 glass-panel p-6 rounded-3xl border border-white/[0.1] space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <CreditCard className="w-5 h-5 text-sky-400" />
                    <div>
                      <h3 className="text-sm font-bold text-white m-0">Direct Razorpay Sandbox Order Tester</h3>
                      <p className="text-xs text-slate-400 m-0">Dispatch live orders directly to Razorpay via AgentShield authorization</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-sky-500/30 text-sky-300">
                    INR / Paise
                  </span>
                </div>

                <form onSubmit={handleDirectRazorpayOrder} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Amount (INR ₹)</label>
                      <input
                        type="number"
                        value={rzpAmount}
                        onChange={(e) => setRzpAmount(e.target.value)}
                        required
                        className="w-full bg-slate-950 border border-white/[0.1] focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                        placeholder="1500"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        Converts to {(parseInt(rzpAmount || '0', 10) * 100).toLocaleString()} paise on Razorpay
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Category</label>
                      <input
                        type="text"
                        value={rzpCategory}
                        onChange={(e) => setRzpCategory(e.target.value)}
                        required
                        className="w-full bg-slate-950 border border-white/[0.1] focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                        placeholder="footwear"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        Authorized: footwear (deviations trigger BLOCK)
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Purpose</label>
                      <input
                        type="text"
                        value={rzpPurpose}
                        onChange={(e) => setRzpPurpose(e.target.value)}
                        required
                        className="w-full bg-slate-950 border border-white/[0.1] focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                        placeholder="running shoes"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Receipt Identifier</label>
                      <input
                        type="text"
                        value={rzpReceipt}
                        onChange={(e) => setRzpReceipt(e.target.value)}
                        className="w-full bg-slate-950 border border-white/[0.1] focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono"
                        placeholder="rcpt_custom_101"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <div className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-sky-400" />
                      Passes through full policy & intent validation pipeline
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-sky-500 hover:bg-sky-400 text-white font-semibold px-6 py-2.5 rounded-xl text-xs transition flex items-center gap-2 shadow-lg disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Create Razorpay Order
                    </button>
                  </div>
                </form>
              </div>

              {/* Card 2: Razorpay Order Verifier & Gateway Status */}
              <div className="glass-panel p-6 rounded-3xl border border-white/[0.1] space-y-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-2">
                    <Search className="w-4 h-4 text-indigo-400" />
                    Verify Razorpay Order ID
                  </h3>
                  <p className="text-xs text-slate-400 mb-3">
                    Query Razorpay Test API to inspect settled order state.
                  </p>

                  <form onSubmit={handleLookupOrder} className="space-y-3">
                    <input
                      type="text"
                      value={rzpLookupId}
                      onChange={(e) => setRzpLookupId(e.target.value)}
                      placeholder="order_RzpTest12345"
                      className="w-full bg-slate-950 border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-white font-mono"
                    />
                    <button
                      type="submit"
                      disabled={lookupLoading || !rzpLookupId.trim()}
                      className="w-full bg-slate-800 hover:bg-slate-750 text-slate-200 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5"
                    >
                      <Search className="w-3.5 h-3.5" />
                      Fetch Order Status
                    </button>
                  </form>

                  {lookupResult && (
                    <div className="mt-3 p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono space-y-1">
                      <div className="text-slate-400">Order Result:</div>
                      <pre className="text-sky-300 overflow-x-auto m-0">
                        {JSON.stringify(lookupResult.provider_result || lookupResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Provider Mode:</span>
                    <span className="text-white font-mono font-semibold">
                      {isRazorpayActive ? 'Razorpay Test Sandbox' : 'Sandbox (Mock Fallback)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Base API:</span>
                    <span className="text-slate-300 font-mono">api.razorpay.com/v1</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab 3: Attack & Scenario Lab */}
        {activeTab === 'scenarios' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2 m-0">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Interactive Attack Scenarios & Edge Cases
                </h3>
                <p className="text-xs text-slate-400 m-0">
                  Demonstrate why AgentShield is an authorization firewall rather than a basic spending counter.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Scenario 1: Semantic Prompt Injection */}
              <div className="glass-card p-5 rounded-2xl border border-rose-500/30 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                      CATEGORY MISMATCH
                    </span>
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">1. Prompt Injection</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Agent attempts to buy a ₹4,999 Gift Card. Matches amount limit but violates user intent.
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
                  className="w-full bg-rose-600/80 hover:bg-rose-500 text-white font-semibold py-2 rounded-xl text-xs transition"
                >
                  Test Prompt Injection
                </button>
              </div>

              {/* Scenario 2: High-Value Human Review */}
              <div className="glass-card p-5 rounded-2xl border border-amber-500/30 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                      REVIEW REQUIRED
                    </span>
                    <UserCheck className="w-4 h-4 text-amber-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">2. High-Value Order</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
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
                  className="w-full bg-amber-600/80 hover:bg-amber-500 text-white font-semibold py-2 rounded-xl text-xs transition"
                >
                  Test Review Gate
                </button>
              </div>

              {/* Scenario 3: Aggregate Budget Overrun */}
              <div className="glass-card p-5 rounded-2xl border border-rose-500/30 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                      BUDGET BREACH
                    </span>
                    <Activity className="w-4 h-4 text-rose-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">3. Aggregate Overrun</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Attempt ₹8,000 purchase. Previous orders push total spend above ₹10,000 session cap.
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
                  className="w-full bg-rose-600/80 hover:bg-rose-500 text-white font-semibold py-2 rounded-xl text-xs transition"
                >
                  Test Budget Overrun
                </button>
              </div>

              {/* Scenario 4: Burst Velocity */}
              <div className="glass-card p-5 rounded-2xl border border-purple-500/30 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                      BURST LIMIT
                    </span>
                    <Clock className="w-4 h-4 text-purple-400" />
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">4. Frequency Anomaly</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Fire 5 consecutive orders rapidly. Violates sliding-window limit (4 req/60s).
                  </p>
                </div>
                <button
                  onClick={() => void handleVelocityBurst()}
                  disabled={loading}
                  className="w-full bg-purple-600/80 hover:bg-purple-500 text-white font-semibold py-2 rounded-xl text-xs transition"
                >
                  Test Velocity Burst
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Tab 4: Audit Trail & Transactions Ledger */}
        {activeTab === 'audit' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2 m-0">
                  <Layers className="w-4 h-4 text-sky-400" />
                  Security Decision Audit Trail
                </h3>
                <p className="text-xs text-slate-400 m-0">
                  Every sensitive tool call is permanently recorded with decision evidence and risk scores.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleResetSpend}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-mono transition flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Session Spend
                </button>
                <button
                  onClick={handleReconcile}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-mono transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reconcile Stranded
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl glass-panel border border-white/[0.08]">
              <table className="w-full text-left text-xs text-slate-300 font-mono">
                <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Decision</th>
                    <th className="py-3 px-4">Risk Level</th>
                    <th className="py-3 px-4">Tool & Args</th>
                    <th className="py-3 px-4">Reasons / Evidence</th>
                    <th className="py-3 px-4">Transaction / Provider</th>
                    <th className="py-3 px-4 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {auditEvents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                        No audit events recorded yet. Run a prompt or transaction above.
                      </td>
                    </tr>
                  ) : (
                    auditEvents.map((event) => (
                      <tr
                        key={event.event_id}
                        onClick={() => setSelectedEvent(event)}
                        className="hover:bg-slate-900/60 transition cursor-pointer"
                      >
                        <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              event.decision === 'ALLOW'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : event.decision === 'REVIEW'
                                ? 'bg-amber-950 text-amber-400 border border-amber-800'
                                : 'bg-rose-950 text-rose-400 border border-rose-800'
                            }`}
                          >
                            {event.decision}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] ${
                              event.risk_level === 'CRITICAL'
                                ? 'bg-red-950 text-red-300 border border-red-800'
                                : event.risk_level === 'HIGH'
                                ? 'bg-orange-950 text-orange-300 border border-orange-800'
                                : event.risk_level === 'MEDIUM'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            }`}
                          >
                            {event.risk_level || 'LOW'} ({event.risk_score.toFixed(2)})
                          </span>
                        </td>
                        <td className="py-3 px-4 font-sans">
                          <span className="font-mono text-sky-300 font-semibold">{event.tool_name}</span>
                          <span className="text-slate-400 ml-1 text-xs">
                            ({JSON.stringify(event.arguments).slice(0, 32)}...)
                          </span>
                        </td>
                        <td className="py-3 px-4 font-sans">
                          {event.reasons.length > 0 ? (
                            <span className="text-rose-300 font-medium">
                              {event.reasons.join(', ')}
                            </span>
                          ) : (
                            <span className="text-emerald-400 text-[11px]">Valid & Compliant</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-400 whitespace-nowrap text-[11px]">
                          {event.transaction_id ?? '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(event);
                            }}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
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

      {/* Audit Detail Modal Drawer */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="glass-panel rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-white/[0.15]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-white text-sm m-0">
                  Audit Record: {selectedEvent.event_id}
                </h3>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500">Decision:</span>{' '}
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
                  <span className="text-slate-500">Risk Level:</span>{' '}
                  <span className="text-amber-300 font-bold">{selectedEvent.risk_level} ({selectedEvent.risk_score})</span>
                </div>
                <div>
                  <span className="text-slate-500">Session ID:</span>{' '}
                  <span className="text-slate-300">{selectedEvent.session_id}</span>
                </div>
                <div>
                  <span className="text-slate-500">Timestamp:</span>{' '}
                  <span className="text-slate-300">{selectedEvent.timestamp}</span>
                </div>
              </div>

              <div>
                <h4 className="text-slate-400 uppercase text-[10px] tracking-wider mb-2 font-bold">Raw Audit Payload</h4>
                <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 text-emerald-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="glass-panel border-t border-white/[0.08] px-6 py-4 text-center text-xs text-slate-500 mt-auto">
        AgentShield · The agent may request an action. The agent never authorizes its own action.
      </footer>
    </div>
  );
}
