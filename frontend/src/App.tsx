import React, { useCallback, useEffect, useState } from 'react';
import {
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
  Copy
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
    <div className="min-h-screen bg-black text-[#ededed] flex flex-col font-sans selection:bg-zinc-800 selection:text-white">
      {/* Top Navbar: GitHub / Vercel style */}
      <header className="border-b border-[#222222] bg-[#000000] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-white text-black flex items-center justify-center font-bold text-xs">
                ▲
              </div>
              <span className="font-bold text-sm tracking-tight text-white">AgentShield</span>
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                v0.1.0
              </span>
            </div>

            {/* Nav links */}
            <nav className="hidden md:flex items-center gap-1 text-xs text-zinc-400">
              <span className="text-zinc-600">/</span>
              <span className="font-mono text-zinc-300 px-2 py-1">heysuhas</span>
              <span className="text-zinc-600">/</span>
              <span className="font-mono text-white px-2 py-1 font-semibold">financial-guardrail</span>
            </nav>
          </div>

          {/* Right status indicators */}
          <div className="flex items-center gap-3 text-xs font-mono">
            {/* Live Gateway Pill */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#111111] border border-[#222222] text-zinc-300">
              <span className={`w-1.5 h-1.5 rounded-full ${isRazorpayActive ? 'bg-emerald-500' : 'bg-blue-500'}`} />
              <span className="text-zinc-400">Gateway:</span>
              <span className="text-white font-medium">
                {isRazorpayActive ? 'Razorpay Sandbox' : 'Mock Gateway'}
              </span>
            </div>

            {/* LLM Model Pill */}
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#111111] border border-[#222222] text-zinc-300">
              <Cpu className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-zinc-400">Model:</span>
              <span className="text-white font-medium">
                {systemHealth?.model?.replace('meta/', '') || 'llama-3.1-8b'}
              </span>
            </div>

            {/* Session ID Pill */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#111111] border border-[#222222]">
              <span className="text-zinc-500">Session:</span>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="bg-transparent text-white font-mono text-xs w-28 focus:outline-none focus:text-blue-400 border-none p-0"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-6 py-8 flex-1 w-full space-y-8">
        {/* Vercel-style Hero Overview */}
        <section className="border-b border-[#222222] pb-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 text-xs font-mono text-zinc-400">
                <span className="text-emerald-400">●</span>
                <span>Active Financial Authorization Layer</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                The Trust Layer Between AI and Money
              </h1>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                Autonomous agents can propose sensitive tool calls, but they never authorize themselves.
                Every operation is validated against deterministic bounds, user intent, and velocity limits before reaching Razorpay.
              </p>
            </div>

            {/* Session Spend Metric Cards (Vercel Style) */}
            <div className="grid grid-cols-2 gap-3 w-full md:w-auto shrink-0 font-mono">
              <div className="vercel-card p-4 rounded-lg min-w-44">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Session Spend</span>
                  <Activity className="w-3.5 h-3.5 text-zinc-500" />
                </div>
                <div className="text-xl font-bold text-white tracking-tight">
                  ₹{session?.total_active_spend.toLocaleString() ?? '0'}
                </div>
                <div className="w-full bg-[#222222] rounded-full h-1 mt-2.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      spendPercent > 90
                        ? 'bg-rose-500'
                        : spendPercent > 70
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                    }`}
                    style={{ width: `${spendPercent}%` }}
                  />
                </div>
                <div className="text-[10px] text-zinc-500 mt-1.5 flex justify-between">
                  <span>Limit: ₹{session?.policy?.max_session_spend?.toLocaleString() ?? '10,000'}</span>
                  <span>{spendPercent}%</span>
                </div>
              </div>

              <div className="vercel-card p-4 rounded-lg min-w-44">
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Human Gate</span>
                  <Lock className="w-3.5 h-3.5 text-zinc-500" />
                </div>
                <div className="text-xl font-bold text-white tracking-tight">
                  {session?.policy?.require_approval_above ? `> ₹${session.policy.require_approval_above.toLocaleString()}` : 'None'}
                </div>
                <div className="text-[10px] text-zinc-500 mt-3.5">
                  Orders over threshold hold for review
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pending Approvals Review Banner (Vercel Alert Style) */}
        {pendingApprovals.length > 0 && (
          <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <UserCheck className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">
                  {pendingApprovals.length} Transaction{pendingApprovals.length > 1 ? 's' : ''} Awaiting Human Authorization
                </span>
              </div>
              <span className="text-xs font-mono text-zinc-400">
                Status: PENDING (Spend Reserved)
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingApprovals.map((appr) => (
                <div
                  key={appr.approval_id}
                  className="p-4 rounded-lg bg-[#0d0d0d] border border-[#262626] flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1.5 font-mono text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-amber-400 font-semibold">{appr.tool_name}</span>
                      <span className="text-zinc-500 text-[11px]">{appr.approval_id}</span>
                    </div>
                    <div className="text-sm font-semibold text-white">
                      ₹{appr.amount?.toLocaleString() ?? 0} {appr.currency}
                    </div>
                    <div className="text-zinc-400 text-[11px]">
                      Args: {JSON.stringify(appr.arguments)}
                    </div>
                    <div className="text-amber-400/90 text-[11px]">
                      Reason: {appr.reasons.join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[#222222]">
                    <button
                      onClick={() => handleApprove(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-white hover:bg-zinc-200 text-black font-semibold py-1.5 px-3 rounded-md text-xs transition flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Authorize & Execute
                    </button>
                    <button
                      onClick={() => handleReject(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-transparent hover:bg-zinc-900 border border-zinc-800 text-zinc-300 font-medium py-1.5 px-3 rounded-md text-xs transition flex items-center justify-center gap-1.5"
                    >
                      <X className="w-3.5 h-3.5" />
                      Reject & Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* GitHub / Vercel Style Navigation Tabs */}
        <div className="border-b border-[#222222] flex items-center gap-6 text-xs font-medium">
          <button
            onClick={() => setActiveTab('agent')}
            className={`pb-3 relative transition flex items-center gap-2 ${
              activeTab === 'agent'
                ? 'text-white font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Agent Guardrail Stream</span>
            {activeTab === 'agent' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('razorpay')}
            className={`pb-3 relative transition flex items-center gap-2 ${
              activeTab === 'razorpay'
                ? 'text-white font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Direct Razorpay Gateway</span>
            {activeTab === 'razorpay' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('scenarios')}
            className={`pb-3 relative transition flex items-center gap-2 ${
              activeTab === 'scenarios'
                ? 'text-white font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Security Test Lab</span>
            {activeTab === 'scenarios' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`pb-3 relative transition flex items-center gap-2 ${
              activeTab === 'audit'
                ? 'text-white font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Audit Trail ({auditEvents.length})</span>
            {activeTab === 'audit' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-white" />
            )}
          </button>
        </div>

        {/* Tab 1: Agent Guardrail Stream */}
        {activeTab === 'agent' && (
          <section className="space-y-6">
            {/* Prompt Console Bar */}
            <div className="vercel-card p-5 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                  Natural Language Prompt
                </span>
                <span className="font-mono text-zinc-500 text-[11px]">
                  Authorized Intent: footwear · running shoes · max ₹5,000
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAgentRun()}
                  placeholder="Ask the AI agent (e.g. 'Buy running shoes under ₹5,000')..."
                  className="flex-1 vercel-input px-4 py-2.5 text-sm font-mono placeholder:text-zinc-600"
                />
                <button
                  onClick={() => handleAgentRun()}
                  disabled={loading || !agentPrompt.trim()}
                  className="bg-white hover:bg-zinc-200 text-black font-semibold px-4 py-2.5 rounded-lg text-xs transition flex items-center gap-2 shrink-0 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {loading ? 'Evaluating...' : 'Run Agent'}
                </button>
              </div>

              {/* Sample Intent Chips */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                <span className="text-zinc-500">Presets:</span>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹1,500');
                    void handleAgentRun('Buy running shoes for ₹1,500');
                  }}
                  className="px-2.5 py-1 rounded bg-[#161616] border border-[#262626] text-zinc-300 hover:border-zinc-500 transition"
                >
                  Valid Order (₹1,500)
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy ₹4,999 Amazon gift card');
                    void handleAgentRun('Buy ₹4,999 Amazon gift card');
                  }}
                  className="px-2.5 py-1 rounded bg-[#161616] border border-[#262626] text-rose-300 hover:border-rose-500/50 transition"
                >
                  Prompt Injection: Gift Card (₹4,999)
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹4,500');
                    void handleAgentRun('Buy running shoes for ₹4,500');
                  }}
                  className="px-2.5 py-1 rounded bg-[#161616] border border-[#262626] text-amber-300 hover:border-amber-500/50 transition"
                >
                  High Value (₹4,500 &gt; ₹3,000)
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Payout ₹8,000 to merchant');
                    void handleAgentRun('Payout ₹8,000 to merchant');
                  }}
                  className="px-2.5 py-1 rounded bg-[#161616] border border-[#262626] text-rose-300 hover:border-rose-500/50 transition"
                >
                  Disallowed Tool: create_payout
                </button>
              </div>
            </div>

            {/* Vercel-Style Pipeline Execution Trace */}
            {lastResult && (
              <div className="vercel-card p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-[#222222] pb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono uppercase text-zinc-500">Pipeline Result</span>
                    <span className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold ${
                      lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      {lastResult.decision || lastResult.execution?.decision || 'PROCESSED'}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-zinc-500">
                    Session: {sessionId}
                  </span>
                </div>

                {/* 4 Steps Horizontal Chain */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 font-mono text-xs">
                  {/* Step 1: User Request */}
                  <div className="p-4 rounded-lg bg-[#0d0d0d] border border-[#222222] space-y-1.5">
                    <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">
                      1. User Input
                    </div>
                    <div className="text-white font-sans text-xs truncate">
                      "{lastResult.user_prompt || agentPrompt}"
                    </div>
                    <div className="text-zinc-500 text-[11px]">
                      Intent: {session?.intent?.category || 'footwear'}
                    </div>
                  </div>

                  {/* Step 2: NIM Model Proposal */}
                  <div className="p-4 rounded-lg bg-[#0d0d0d] border border-[#222222] space-y-1.5">
                    <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">
                      2. NIM Proposal
                    </div>
                    <div className="text-zinc-200 truncate">
                      {lastResult.proposed_tool_name || lastResult.execution?.tool_name || 'create_order'}()
                    </div>
                    <div className="text-zinc-500 text-[11px]">
                      Amount: ₹{lastResult.proposed_arguments?.amount || lastResult.execution?.arguments?.amount || '—'}
                    </div>
                  </div>

                  {/* Step 3: AgentShield Guard */}
                  <div className="p-4 rounded-lg bg-[#0d0d0d] border border-[#222222] space-y-1.5">
                    <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">
                      3. Shield Guard
                    </div>
                    <div className="text-white">
                      Risk: {lastResult.execution?.risk_level || lastResult.risk_level || 'LOW'}
                    </div>
                    <div className="text-zinc-500 text-[11px] truncate">
                      {lastResult.execution?.reasons?.length > 0
                        ? lastResult.execution.reasons.join(', ')
                        : 'Bounds & Policy Passed'}
                    </div>
                  </div>

                  {/* Step 4: Razorpay Gateway Rails */}
                  <div className="p-4 rounded-lg bg-[#0d0d0d] border border-[#222222] space-y-1.5">
                    <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">
                      4. Razorpay Sandbox
                    </div>
                    {lastResult.execution?.provider_result?.order || lastResult.provider_result?.order ? (
                      <div className="text-emerald-400 truncate">
                        {lastResult.execution?.provider_result?.order?.id || lastResult.provider_result?.order?.id}
                      </div>
                    ) : lastResult.execution?.decision === 'REVIEW' || lastResult.decision === 'REVIEW' ? (
                      <div className="text-amber-400">
                        Held for Review
                      </div>
                    ) : (
                      <div className="text-rose-400">
                        Execution Blocked
                      </div>
                    )}
                    <div className="text-zinc-500 text-[11px]">
                      {lastResult.execution?.provider_result?.order ? 'Order Created' : 'Provider Guarded'}
                    </div>
                  </div>
                </div>

                {/* Plain-English Explanation Banner */}
                <div className={`p-4 rounded-lg border text-xs font-mono flex items-start gap-3 ${
                  lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                    ? 'bg-emerald-500/[0.04] border-emerald-500/30 text-emerald-300'
                    : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                    ? 'bg-amber-500/[0.04] border-amber-500/30 text-amber-300'
                    : 'bg-rose-500/[0.04] border-rose-500/30 text-rose-300'
                }`}>
                  <div className="mt-0.5">
                    {lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW' ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW' ? (
                      <Lock className="w-4 h-4 text-amber-400" />
                    ) : (
                      <AlertOctagon className="w-4 h-4 text-rose-400" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="font-bold">
                      {lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'ALLOW: Transaction authorized and dispatched to payment provider.'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'REVIEW: Transaction exceeds operator threshold. Spend reserved awaiting human sign-off.'
                        : 'BLOCK: Operation prevented by AgentShield boundary.'}
                    </div>
                    <p className="text-zinc-400 font-sans leading-relaxed m-0">
                      {lastResult.execution?.policy_violations?.length > 0
                        ? `Policy Violation: ${lastResult.execution.policy_violations.map((v: any) => `${v.rule} (Limit: ${v.limit}, Actual: ${v.actual})`).join(', ')}`
                        : lastResult.execution?.reasons?.length > 0
                        ? `Interception Reason: ${lastResult.execution.reasons.join(', ')}`
                        : 'Transaction matches authorized category, purpose, and amount ceiling.'}
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
              {/* Card 1: Direct Order Form */}
              <div className="md:col-span-2 vercel-card p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-[#222222] pb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Direct Razorpay Order Dispatch</h3>
                    <p className="text-xs text-zinc-400">Dispatch live orders to Razorpay Sandbox through the AgentShield boundary</p>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                    INR / Paise
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
                        className="w-full vercel-input px-3 py-2 text-xs font-mono text-white"
                        placeholder="1500"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 block font-mono">
                        Converts to {(parseInt(rzpAmount || '0', 10) * 100).toLocaleString()} paise
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-mono">Category</label>
                      <input
                        type="text"
                        value={rzpCategory}
                        onChange={(e) => setRzpCategory(e.target.value)}
                        required
                        className="w-full vercel-input px-3 py-2 text-xs font-mono text-white"
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
                        className="w-full vercel-input px-3 py-2 text-xs font-mono text-white"
                        placeholder="running shoes"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-mono">Receipt ID</label>
                      <input
                        type="text"
                        value={rzpReceipt}
                        onChange={(e) => setRzpReceipt(e.target.value)}
                        className="w-full vercel-input px-3 py-2 text-xs font-mono text-white"
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
                      className="bg-white hover:bg-zinc-200 text-black font-semibold px-5 py-2 rounded-md text-xs transition disabled:opacity-50"
                    >
                      Create Razorpay Order
                    </button>
                  </div>
                </form>
              </div>

              {/* Card 2: Razorpay Order Verifier */}
              <div className="vercel-card p-6 space-y-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">Verify Razorpay Order</h3>
                  <p className="text-xs text-zinc-400 mb-4">
                    Query Razorpay Sandbox API to inspect settled order state.
                  </p>

                  <form onSubmit={handleLookupOrder} className="space-y-3">
                    <input
                      type="text"
                      value={rzpLookupId}
                      onChange={(e) => setRzpLookupId(e.target.value)}
                      placeholder="order_RzpTest123..."
                      className="w-full vercel-input px-3 py-2 text-xs font-mono text-white"
                    />
                    <button
                      type="submit"
                      disabled={lookupLoading || !rzpLookupId.trim()}
                      className="w-full bg-[#161616] hover:bg-[#202020] border border-[#262626] text-white py-2 rounded-md text-xs font-medium transition"
                    >
                      Fetch Order Status
                    </button>
                  </form>

                  {lookupResult && (
                    <div className="mt-3 p-3 rounded-md bg-[#050505] border border-[#222222] text-[11px] font-mono space-y-1">
                      <div className="text-zinc-400">Order Payload:</div>
                      <pre className="text-zinc-300 overflow-x-auto m-0">
                        {JSON.stringify(lookupResult.provider_result || lookupResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-[#222222] text-[11px] font-mono text-zinc-400 space-y-1">
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

        {/* Tab 3: Security Test Lab */}
        {activeTab === 'scenarios' && (
          <section className="space-y-6">
            <div>
              <h3 className="text-base font-semibold text-white">Security & Attack Scenarios</h3>
              <p className="text-xs text-zinc-400">
                Demonstrates how AgentShield halts attacks that pass ordinary spending limits.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
              {/* Scenario 1: Prompt Injection */}
              <div className="vercel-card p-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-rose-400 font-bold">CATEGORY MISMATCH</span>
                  </div>
                  <h4 className="text-sm font-semibold text-white font-sans mb-1">1. Prompt Injection</h4>
                  <p className="text-xs text-zinc-400 font-sans leading-relaxed">
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
                  className="w-full bg-[#161616] hover:bg-zinc-800 border border-zinc-700 text-white font-medium py-2 rounded-md text-xs transition"
                >
                  Run Scenario
                </button>
              </div>

              {/* Scenario 2: High Value Review */}
              <div className="vercel-card p-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-amber-400 font-bold">REVIEW REQUIRED</span>
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
                  className="w-full bg-[#161616] hover:bg-zinc-800 border border-zinc-700 text-white font-medium py-2 rounded-md text-xs transition"
                >
                  Run Scenario
                </button>
              </div>

              {/* Scenario 3: Aggregate Overrun */}
              <div className="vercel-card p-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-rose-400 font-bold">BUDGET OVERRUN</span>
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
                  className="w-full bg-[#161616] hover:bg-zinc-800 border border-zinc-700 text-white font-medium py-2 rounded-md text-xs transition"
                >
                  Run Scenario
                </button>
              </div>

              {/* Scenario 4: Velocity Burst */}
              <div className="vercel-card p-5 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-rose-400 font-bold">BURST LIMIT</span>
                  </div>
                  <h4 className="text-sm font-semibold text-white font-sans mb-1">4. Velocity Burst</h4>
                  <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                    Fire 5 consecutive orders rapidly. Violates sliding-window limit (4 req/60s).
                  </p>
                </div>
                <button
                  onClick={() => void handleVelocityBurst()}
                  disabled={loading}
                  className="w-full bg-[#161616] hover:bg-zinc-800 border border-zinc-700 text-white font-medium py-2 rounded-md text-xs transition"
                >
                  Run Scenario
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Tab 4: Audit Trail Table (GitHub / Vercel Log Style) */}
        {activeTab === 'audit' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">Security Audit Log</h3>
                <p className="text-xs text-zinc-400">
                  Tamper-evident record of all agent execution requests and policy decisions.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleResetSpend}
                  className="px-3 py-1.5 rounded bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] text-zinc-300 text-xs font-mono transition flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Spend
                </button>
                <button
                  onClick={handleReconcile}
                  className="px-3 py-1.5 rounded bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] text-zinc-300 text-xs font-mono transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reconcile
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[#222222] overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#0a0a0a] text-zinc-400 border-b border-[#222222] text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4">Decision</th>
                    <th className="py-3 px-4">Risk</th>
                    <th className="py-3 px-4">Tool</th>
                    <th className="py-3 px-4">Reasons</th>
                    <th className="py-3 px-4">Transaction</th>
                    <th className="py-3 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1e1e1e] bg-[#000000]">
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
                        className="hover:bg-[#0a0a0a] transition cursor-pointer"
                      >
                        <td className="py-3 px-4 text-zinc-400 whitespace-nowrap">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              event.decision === 'ALLOW'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : event.decision === 'REVIEW'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {event.decision}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="text-zinc-300">
                            {event.risk_level || 'LOW'} ({event.risk_score.toFixed(2)})
                          </span>
                        </td>
                        <td className="py-3 px-4 text-zinc-200">
                          {event.tool_name}
                        </td>
                        <td className="py-3 px-4 text-zinc-400 font-sans text-xs">
                          {event.reasons.length > 0 ? (
                            <span className="text-rose-400 font-medium">
                              {event.reasons.join(', ')}
                            </span>
                          ) : (
                            <span className="text-emerald-400">Valid</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-zinc-500 whitespace-nowrap text-[11px]">
                          {event.transaction_id || '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(event);
                            }}
                            className="p-1 rounded hover:bg-[#1a1a1a] text-zinc-400 hover:text-white"
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

      {/* JSON Inspector Drawer (GitHub / Vercel style) */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#0a0a0a] border border-[#262626] rounded-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-[#222222] flex items-center justify-between bg-[#000000]">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-zinc-500">Event:</span>
                <span className="text-white font-semibold">{selectedEvent.event_id}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(selectedEvent, null, 2))}
                  className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white text-xs flex items-center gap-1 font-mono"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedText ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3 bg-[#050505] p-3 rounded-lg border border-[#222222]">
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
                <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-1.5 font-bold">Raw Payload</div>
                <pre className="bg-[#000000] p-4 rounded-lg border border-[#222222] text-zinc-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vercel / GitHub Style Footer */}
      <footer className="border-t border-[#222222] px-6 py-4 text-center text-xs font-mono text-zinc-600 mt-auto">
        AgentShield · The agent may request an action. The agent never authorizes its own action.
      </footer>
    </div>
  );
}
