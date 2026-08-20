import React, { useCallback, useEffect, useState } from 'react';
import {
  Shield,
  Activity,
  RotateCcw,
  RefreshCw,
  CreditCard,
  ChevronRight,
  UserCheck,
  Lock,
  Cpu,
  X,
  Send,
  Bot,
  Copy,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  Info,
  Server,
  Database
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
    <div className="min-h-screen bg-[#030712] text-[#f8fafc] flex flex-col font-sans selection:bg-blue-500/30 selection:text-blue-200 antialiased relative">
      {/* Background Atmosphere Aura matching CloudPeak reference */}
      <div className="absolute top-0 left-0 right-0 h-[650px] hero-glow pointer-events-none z-0" />

      {/* Floating Modern Header / Nav Bar */}
      <header className="relative z-50 pt-6 px-6 max-w-6xl mx-auto w-full">
        <div className="rounded-full bg-[#0a0f1d]/70 backdrop-blur-xl border border-white/[0.1] px-6 py-3 flex items-center justify-between shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600/30 border border-blue-400/40 flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.4)]">
              <Shield className="w-4 h-4 text-blue-400" />
            </div>
            <span className="font-bold text-base tracking-tight text-white">AgentShield</span>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
            <button
              onClick={() => setActiveTab('agent')}
              className={`transition hover:text-white ${activeTab === 'agent' ? 'text-blue-400 font-semibold' : ''}`}
            >
              Agent Stream
            </button>
            <button
              onClick={() => setActiveTab('razorpay')}
              className={`transition hover:text-white ${activeTab === 'razorpay' ? 'text-blue-400 font-semibold' : ''}`}
            >
              Razorpay Gateway
            </button>
            <button
              onClick={() => setActiveTab('scenarios')}
              className={`transition hover:text-white ${activeTab === 'scenarios' ? 'text-blue-400 font-semibold' : ''}`}
            >
              Security Lab
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`transition hover:text-white ${activeTab === 'audit' ? 'text-blue-400 font-semibold' : ''}`}
            >
              Audit Trail
            </button>
          </nav>

          {/* CTA & Environment Pill */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 border border-white/[0.1] text-[11px] font-mono text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{isRazorpayActive ? 'Razorpay Test' : 'Sandbox Mode'}</span>
            </div>

            <button
              onClick={() => setActiveTab('agent')}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.15] text-xs font-semibold text-white transition duration-200"
            >
              <span>Live Console</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-16 pb-12 text-center space-y-6">
        {/* Pill Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 text-blue-300 text-xs font-mono font-medium shadow-[0_0_20px_rgba(37,99,235,0.2)]">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span>The Authorization & Risk Layer Between AI and Money</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white leading-tight max-w-4xl mx-auto">
          Elevate AI Financial Safety with AgentShield
        </h1>

        {/* Subtitle */}
        <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Empowering autonomous AI agents with deterministic spend boundaries, semantic intent validation, and live Razorpay payment rails.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          <button
            onClick={() => setActiveTab('agent')}
            className="btn-primary-glow px-6 py-3 rounded-full text-white text-sm font-semibold flex items-center gap-2"
          >
            <span>Launch Agent Console</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => setActiveTab('razorpay')}
            className="px-6 py-3 rounded-full bg-slate-900/80 hover:bg-slate-800 border border-white/[0.12] text-slate-200 text-sm font-semibold transition"
          >
            Test Razorpay Gateway
          </button>
        </div>
      </section>

      {/* Main Interactive Showcase Window (Matching Centerpiece in Reference Image) */}
      <section className="relative z-20 max-w-6xl mx-auto px-6 pb-16 w-full">
        <div className="cloudpeak-window rounded-3xl overflow-hidden border border-white/[0.15]">
          {/* Window Top Controls & Header */}
          <div className="bg-[#090d19]/90 px-6 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* macOS Dots */}
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-900 border border-white/[0.08] text-xs font-mono">
                <span className="text-slate-500">session:</span>
                <input
                  type="text"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="bg-transparent text-slate-200 font-mono text-xs w-28 focus:outline-none focus:text-blue-400 border-none p-0"
                />
              </div>
            </div>

            {/* Top Quick Status Metric Pills */}
            <div className="flex items-center gap-3 text-xs font-mono">
              <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-white/[0.08]">
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-slate-400">Spend:</span>
                <span className="text-white font-bold">
                  ₹{session?.total_active_spend.toLocaleString() ?? '0'}
                </span>
                <div className="w-12 bg-slate-800 rounded-full h-1.5 overflow-hidden ml-1">
                  <div
                    className={`h-full transition-all duration-300 ${
                      spendPercent > 90
                        ? 'bg-rose-500'
                        : spendPercent > 70
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                    }`}
                    style={{ width: `${spendPercent}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 border border-white/[0.08]">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-slate-400">Review Gate:</span>
                <span className="text-amber-300 font-bold">
                  {session?.policy?.require_approval_above ? `> ₹${session.policy.require_approval_above.toLocaleString()}` : 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* Window Inner Content */}
          <div className="p-6 md:p-8 space-y-7 bg-[#070b16]/60">
            {/* Pending Approvals Queue if any */}
            {pendingApprovals.length > 0 && (
              <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <UserCheck className="w-5 h-5 text-amber-400" />
                    <span className="text-sm font-bold text-amber-200">
                      Human Review Required ({pendingApprovals.length} Transaction{pendingApprovals.length > 1 ? 's' : ''} Held)
                    </span>
                  </div>
                  <span className="text-xs font-mono text-amber-400/80">Spend is safely held in PENDING state</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  {pendingApprovals.map((appr) => (
                    <div
                      key={appr.approval_id}
                      className="p-4 rounded-xl bg-[#090d18] border border-amber-500/30 flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-1 text-xs font-mono">
                        <div className="flex items-center justify-between">
                          <span className="text-amber-400 font-bold px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-[10px]">
                            REVIEW REQUIRED
                          </span>
                          <span className="text-slate-500">{appr.approval_id}</span>
                        </div>
                        <div className="text-sm font-semibold text-white pt-1">
                          {appr.tool_name} — ₹{appr.amount?.toLocaleString() ?? 0} {appr.currency}
                        </div>
                        <div className="text-slate-400 text-[11px]">Args: {JSON.stringify(appr.arguments)}</div>
                        <div className="text-amber-300 text-[11px]">Reason: {appr.reasons.join(', ')}</div>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                        <button
                          onClick={() => handleApprove(appr.approval_id)}
                          disabled={reviewingId === appr.approval_id}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-1.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Authorize & Execute
                        </button>
                        <button
                          onClick={() => handleReject(appr.approval_id)}
                          disabled={reviewingId === appr.approval_id}
                          className="flex-1 bg-slate-800 hover:bg-slate-750 text-slate-300 font-medium py-1.5 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject & Cancel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 1: Agent Stream */}
            {activeTab === 'agent' && (
              <div className="space-y-6">
                {/* Natural Language Prompt Box */}
                <div className="cloudpeak-card p-6 rounded-2xl border border-white/[0.1] space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Bot className="w-4 h-4 text-blue-400" />
                      Natural Language AI Agent Prompt
                    </label>
                    <span className="font-mono text-slate-400 text-[11px]">
                      Authorized Intent: footwear · running shoes · max ₹5,000
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={agentPrompt}
                        onChange={(e) => setAgentPrompt(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAgentRun()}
                        placeholder="Instruct the AI agent (e.g. 'Buy running shoes under ₹5,000')..."
                        className="w-full cloudpeak-input px-4 py-3 text-sm font-mono placeholder:text-slate-500 pr-10"
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
                      className="btn-primary-glow px-6 py-3 rounded-xl text-white text-xs font-semibold flex items-center gap-2 shrink-0 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{loading ? 'Evaluating...' : 'Dispatch Agent'}</span>
                    </button>
                  </div>

                  {/* Preset Chips */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    <span className="text-slate-500">Presets:</span>
                    <button
                      onClick={() => {
                        setAgentPrompt('Buy running shoes for ₹1,500');
                        void handleAgentRun('Buy running shoes for ₹1,500');
                      }}
                      className="px-3 py-1 rounded-full bg-slate-900 border border-emerald-500/30 text-emerald-300 hover:bg-slate-800 transition"
                    >
                      ✓ Valid Order (₹1,500)
                    </button>
                    <button
                      onClick={() => {
                        setAgentPrompt('Buy ₹4,999 Amazon gift card');
                        void handleAgentRun('Buy ₹4,999 Amazon gift card');
                      }}
                      className="px-3 py-1 rounded-full bg-slate-900 border border-rose-500/30 text-rose-300 hover:bg-slate-800 transition"
                    >
                      ✗ Prompt Injection (₹4,999)
                    </button>
                    <button
                      onClick={() => {
                        setAgentPrompt('Buy running shoes for ₹4,500');
                        void handleAgentRun('Buy running shoes for ₹4,500');
                      }}
                      className="px-3 py-1 rounded-full bg-slate-900 border border-amber-500/30 text-amber-300 hover:bg-slate-800 transition"
                    >
                      ⚠ High-Value Review (₹4,500)
                    </button>
                    <button
                      onClick={() => {
                        setAgentPrompt('Payout ₹8,000 to merchant');
                        void handleAgentRun('Payout ₹8,000 to merchant');
                      }}
                      className="px-3 py-1 rounded-full bg-slate-900 border border-rose-500/30 text-rose-300 hover:bg-slate-800 transition"
                    >
                      ✗ Disallowed Tool: create_payout
                    </button>
                  </div>
                </div>

                {/* 4-Step Animated Pipeline Trace */}
                {lastResult && (
                  <div className="cloudpeak-card p-6 rounded-2xl border border-white/[0.1] space-y-6">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono uppercase text-slate-400">Pipeline Evaluation</span>
                        <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold ${
                          lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                            : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.2)]'
                        }`}>
                          {lastResult.decision || lastResult.execution?.decision || 'PROCESSED'}
                        </span>
                      </div>
                      <span className="text-xs font-mono text-slate-500">Session: {sessionId}</span>
                    </div>

                    {/* 4 Cards Flow */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 font-mono text-xs">
                      {/* Step 1 */}
                      <div className="p-4 rounded-xl bg-[#080c18] border border-white/[0.08] space-y-1.5">
                        <div className="text-blue-400 text-[10px] uppercase font-bold tracking-wider">1. User Input</div>
                        <div className="text-white font-sans text-xs truncate">"{lastResult.user_prompt || agentPrompt}"</div>
                        <div className="text-slate-500 text-[11px]">Intent: {session?.intent?.category || 'footwear'}</div>
                      </div>

                      {/* Step 2 */}
                      <div className="p-4 rounded-xl bg-[#080c18] border border-white/[0.08] space-y-1.5">
                        <div className="text-indigo-400 text-[10px] uppercase font-bold tracking-wider">2. NIM Proposal</div>
                        <div className="text-indigo-300 font-semibold truncate">
                          {lastResult.proposed_tool_name || lastResult.execution?.tool_name || 'create_order'}()
                        </div>
                        <div className="text-slate-500 text-[11px]">
                          Amount: ₹{lastResult.proposed_arguments?.amount || lastResult.execution?.arguments?.amount || '—'}
                        </div>
                      </div>

                      {/* Step 3 */}
                      <div className="p-4 rounded-xl bg-[#080c18] border border-white/[0.08] space-y-1.5">
                        <div className="text-purple-400 text-[10px] uppercase font-bold tracking-wider">3. Shield Guard</div>
                        <div className="text-white font-semibold">
                          Risk: {lastResult.execution?.risk_level || lastResult.risk_level || 'LOW'}
                        </div>
                        <div className="text-slate-400 text-[11px] truncate">
                          {lastResult.execution?.reasons?.length > 0
                            ? lastResult.execution.reasons.join(', ')
                            : 'Bounds & Policy Passed'}
                        </div>
                      </div>

                      {/* Step 4 */}
                      <div className="p-4 rounded-xl bg-[#080c18] border border-white/[0.08] space-y-1.5">
                        <div className="text-emerald-400 text-[10px] uppercase font-bold tracking-wider">4. Razorpay Rails</div>
                        {lastResult.execution?.provider_result?.order || lastResult.provider_result?.order ? (
                          <div className="text-emerald-400 font-semibold truncate">
                            {lastResult.execution?.provider_result?.order?.id || lastResult.provider_result?.order?.id}
                          </div>
                        ) : lastResult.execution?.decision === 'REVIEW' || lastResult.decision === 'REVIEW' ? (
                          <div className="text-amber-400 font-semibold">Held for Review</div>
                        ) : (
                          <div className="text-rose-400 font-semibold">Execution Blocked</div>
                        )}
                        <div className="text-slate-500 text-[11px]">
                          {lastResult.execution?.provider_result?.order ? 'Order Created' : 'Provider Guarded'}
                        </div>
                      </div>
                    </div>

                    {/* Result Reason Banner */}
                    <div className={`p-4 rounded-xl border text-xs font-mono flex items-start gap-3.5 ${
                      lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    }`}>
                      <Info className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-bold text-sm">
                          {lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                            ? 'ALLOW: Transaction authorized and dispatched to Razorpay.'
                            : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                            ? 'REVIEW: Transaction exceeds operator threshold. Spend reserved awaiting human sign-off.'
                            : 'BLOCK: Operation prevented by AgentShield boundary.'}
                        </div>
                        <p className="text-slate-300 font-sans leading-relaxed m-0">
                          {lastResult.execution?.policy_violations?.length > 0
                            ? `Policy Violation: ${lastResult.execution.policy_violations.map((v: any) => `${v.rule} (Limit: ${v.limit}, Actual: ${v.actual})`).join(', ')}`
                            : lastResult.execution?.reasons?.length > 0
                            ? `Interception Reason: ${lastResult.execution.reasons.join(', ')}`
                            : 'Operation matches user authorized category, purpose, amount ceiling, and sliding-window velocity bounds.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Direct Razorpay Console */}
            {activeTab === 'razorpay' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Direct Order Form */}
                <div className="lg:col-span-2 cloudpeak-card p-6 rounded-2xl border border-white/[0.1] space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">Direct Razorpay Sandbox Order Dispatch</h3>
                      <p className="text-xs text-slate-400">Dispatch test orders directly to Razorpay through the AgentShield boundary</p>
                    </div>
                    <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-blue-300">
                      INR / Paise
                    </span>
                  </div>

                  <form onSubmit={handleDirectRazorpayOrder} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5 font-mono">Amount (INR ₹)</label>
                        <input
                          type="number"
                          value={rzpAmount}
                          onChange={(e) => setRzpAmount(e.target.value)}
                          required
                          className="w-full cloudpeak-input px-3.5 py-2.5 text-xs font-mono text-white"
                          placeholder="1500"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block font-mono">
                          Converts to {(parseInt(rzpAmount || '0', 10) * 100).toLocaleString()} paise on Razorpay
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5 font-mono">Category</label>
                        <input
                          type="text"
                          value={rzpCategory}
                          onChange={(e) => setRzpCategory(e.target.value)}
                          required
                          className="w-full cloudpeak-input px-3.5 py-2.5 text-xs font-mono text-white"
                          placeholder="footwear"
                        />
                        <span className="text-[10px] text-slate-500 mt-1 block font-mono">
                          Authorized: footwear
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5 font-mono">Purpose</label>
                        <input
                          type="text"
                          value={rzpPurpose}
                          onChange={(e) => setRzpPurpose(e.target.value)}
                          required
                          className="w-full cloudpeak-input px-3.5 py-2.5 text-xs font-mono text-white"
                          placeholder="running shoes"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5 font-mono">Receipt ID</label>
                        <input
                          type="text"
                          value={rzpReceipt}
                          onChange={(e) => setRzpReceipt(e.target.value)}
                          className="w-full cloudpeak-input px-3.5 py-2.5 text-xs font-mono text-white"
                          placeholder="rcpt_custom_1001"
                        />
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-between">
                      <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        Evaluates policy & intent before dispatch
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary-glow px-6 py-2.5 rounded-xl text-white text-xs font-semibold transition disabled:opacity-50"
                      >
                        Create Razorpay Order
                      </button>
                    </div>
                  </form>
                </div>

                {/* Razorpay Order Verifier */}
                <div className="cloudpeak-card p-6 rounded-2xl border border-white/[0.1] space-y-4 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Verify Razorpay Order</h3>
                    <p className="text-xs text-slate-400 mb-4">Query Razorpay Sandbox API to inspect settled order state.</p>

                    <form onSubmit={handleLookupOrder} className="space-y-3">
                      <input
                        type="text"
                        value={rzpLookupId}
                        onChange={(e) => setRzpLookupId(e.target.value)}
                        placeholder="order_RzpTest123..."
                        className="w-full cloudpeak-input px-3.5 py-2.5 text-xs font-mono text-white"
                      />
                      <button
                        type="submit"
                        disabled={lookupLoading || !rzpLookupId.trim()}
                        className="w-full bg-slate-800 hover:bg-slate-750 border border-slate-700 text-white py-2.5 rounded-xl text-xs font-semibold transition"
                      >
                        Fetch Order Status
                      </button>
                    </form>

                    {lookupResult && (
                      <div className="mt-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono space-y-1">
                        <div className="text-slate-400">Order Payload:</div>
                        <pre className="text-blue-300 overflow-x-auto m-0">
                          {JSON.stringify(lookupResult.provider_result || lookupResult, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-[11px] font-mono text-slate-400 space-y-1.5">
                    <div className="flex justify-between">
                      <span>Provider Mode:</span>
                      <span className="text-white font-medium">{isRazorpayActive ? 'Razorpay Sandbox' : 'Mock Provider'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>API Endpoint:</span>
                      <span className="text-slate-300">api.razorpay.com/v1</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Security Scenarios */}
            {activeTab === 'scenarios' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-base font-bold text-white">Security & Attack Scenarios</h3>
                  <p className="text-xs text-slate-400">Demonstrates how AgentShield halts attacks that pass ordinary spending limits.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
                  {/* Scenario 1 */}
                  <div className="cloudpeak-card p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-rose-500/30">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-rose-400 font-bold px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-800 text-[10px]">
                          CATEGORY MISMATCH
                        </span>
                        <ShieldAlert className="w-4 h-4 text-rose-400" />
                      </div>
                      <h4 className="text-sm font-semibold text-white font-sans mb-1">1. Prompt Injection</h4>
                      <p className="text-xs text-slate-400 font-sans leading-relaxed">
                        Agent purchases a ₹4,999 Gift Card instead of authorized running shoes.
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

                  {/* Scenario 2 */}
                  <div className="cloudpeak-card p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-amber-500/30">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-amber-400 font-bold px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-[10px]">
                          REVIEW REQUIRED
                        </span>
                        <UserCheck className="w-4 h-4 text-amber-400" />
                      </div>
                      <h4 className="text-sm font-semibold text-white font-sans mb-1">2. High-Value Order</h4>
                      <p className="text-xs text-slate-400 font-sans leading-relaxed">
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

                  {/* Scenario 3 */}
                  <div className="cloudpeak-card p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-rose-500/30">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-rose-400 font-bold px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-800 text-[10px]">
                          BUDGET OVERRUN
                        </span>
                        <Activity className="w-4 h-4 text-rose-400" />
                      </div>
                      <h4 className="text-sm font-semibold text-white font-sans mb-1">3. Aggregate Overrun</h4>
                      <p className="text-xs text-slate-400 font-sans leading-relaxed">
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

                  {/* Scenario 4 */}
                  <div className="cloudpeak-card p-5 rounded-2xl flex flex-col justify-between space-y-4 border border-purple-500/30">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-purple-400 font-bold px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-800 text-[10px]">
                          BURST LIMIT
                        </span>
                        <Clock className="w-4 h-4 text-purple-400" />
                      </div>
                      <h4 className="text-sm font-semibold text-white font-sans mb-1">4. Velocity Burst</h4>
                      <p className="text-xs text-slate-400 font-sans leading-relaxed">
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
              </div>
            )}

            {/* Tab 4: Audit Trail */}
            {activeTab === 'audit' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white">Security Audit Log</h3>
                    <p className="text-xs text-slate-400">Tamper-evident record of all agent execution requests and policy decisions.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleResetSpend}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 text-xs font-mono transition flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset Spend
                    </button>
                    <button
                      onClick={handleReconcile}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-800 text-slate-300 text-xs font-mono transition flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reconcile
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-[#070b16]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#090d1a] text-slate-400 border-b border-slate-800 text-[11px]">
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
                    <tbody className="divide-y divide-slate-800/50">
                      {auditEvents.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                            No audit events recorded yet.
                          </td>
                        </tr>
                      ) : (
                        auditEvents.map((event) => (
                          <tr
                            key={event.event_id}
                            onClick={() => setSelectedEvent(event)}
                            className="hover:bg-slate-900/40 transition cursor-pointer"
                          >
                            <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
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
                              <span className="text-slate-300">
                                {event.risk_level || 'LOW'} ({event.risk_score.toFixed(2)})
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-slate-200">{event.tool_name}</td>
                            <td className="py-3.5 px-4 text-slate-400 font-sans text-xs">
                              {event.reasons.length > 0 ? (
                                <span className="text-rose-400 font-medium">{event.reasons.join(', ')}</span>
                              ) : (
                                <span className="text-emerald-400">Valid</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap text-[11px]">
                              {event.transaction_id || '—'}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedEvent(event);
                                }}
                                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
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
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Social Proof & Trusted Infrastructure (Matching Reference Image) */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-16 text-center space-y-6">
        <p className="text-xs uppercase font-mono tracking-widest text-slate-500">
          Powered by Industry-Standard Infrastructure
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 text-slate-400 font-mono text-sm font-semibold opacity-70">
          <span className="flex items-center gap-2 hover:text-white transition">
            <CreditCard className="w-4 h-4 text-blue-400" /> Razorpay MCP
          </span>
          <span className="flex items-center gap-2 hover:text-white transition">
            <Cpu className="w-4 h-4 text-indigo-400" /> NVIDIA NIM
          </span>
          <span className="flex items-center gap-2 hover:text-white transition">
            <Database className="w-4 h-4 text-emerald-400" /> PostgreSQL
          </span>
          <span className="flex items-center gap-2 hover:text-white transition">
            <Server className="w-4 h-4 text-purple-400" /> FastAPI Engine
          </span>
          <span className="flex items-center gap-2 hover:text-white transition">
            <Shield className="w-4 h-4 text-sky-400" /> Deterministic Kernel
          </span>
        </div>
      </section>

      {/* Bento Grid Feature Showcase (Matching bottom of Reference Image) */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-20 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="cloudpeak-card p-6 rounded-2xl border border-white/[0.08] space-y-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
            <Shield className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-white">Deterministic Guardrails</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Policy bounds, allowed tool permissions, and spending ceilings are strictly enforced in Python before any LLM inference.
          </p>
        </div>

        <div className="cloudpeak-card p-6 rounded-2xl border border-white/[0.08] space-y-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-white">Semantic Intent Verification</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Identifies subtle semantic prompt injections such as purchasing a gift card when the user only authorized running shoes.
          </p>
        </div>

        <div className="cloudpeak-card p-6 rounded-2xl border border-white/[0.08] space-y-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center justify-center">
            <CreditCard className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-white">Razorpay Sandbox Isolation</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Automated subunit conversion, receipt validation, and idempotent dispatch to official Razorpay endpoints.
          </p>
        </div>
      </section>

      {/* Audit Detail Modal Drawer */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="cloudpeak-window rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-white/[0.15]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-[#080c18]">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-slate-500">Event:</span>
                <span className="text-white font-semibold">{selectedEvent.event_id}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(selectedEvent, null, 2))}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white text-xs flex items-center gap-1 font-mono transition"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedText ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
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
                  <span className="text-slate-300 font-bold">{selectedEvent.risk_level} ({selectedEvent.risk_score})</span>
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
                <div className="text-slate-500 uppercase text-[10px] tracking-wider mb-2 font-bold">Raw Audit Payload</div>
                <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 text-blue-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/[0.06] bg-[#02050c] px-6 py-8 text-center text-xs font-mono text-slate-500">
        AgentShield · The trust layer between autonomous AI agents and payment rails.
      </footer>
    </div>
  );
}
