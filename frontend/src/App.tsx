import React, { useCallback, useEffect, useState } from 'react';
import {
  Shield,
  RotateCcw,
  RefreshCw,
  CreditCard,
  ChevronRight,
  UserCheck,
  X,
  Send,
  Bot,
  Copy,
  CheckCircle2,
  XCircle,
  Info,
  ExternalLink,
  Key
} from 'lucide-react';
import {
  approveReview,
  createOrInitSession,
  executeToolCall,
  fetchApprovals,
  fetchAuditEvents,
  fetchHealth,
  fetchPaymentConfig,
  fetchTransactions,
  reconcileSession,
  rejectReview,
  resetSessionSpend,
  runAgent,
  verifyPayment
} from './api';
import type { ApprovalRecord, AuditEvent, SessionData, Transaction } from './types';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

const DEFAULT_SESSION_ID = 'demo_shopper_01';
const DEFAULT_TEST_KEY = 'rzp_test_1DP5mmOlF5G5ag';

type Tab = 'reactor' | 'razorpay' | 'scenarios' | 'audit' | 'sdk';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('reactor');
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION_ID);
  const [session, setSession] = useState<SessionData | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [, setTransactions] = useState<Transaction[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRecord[]>([]);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [paymentConfig, setPaymentConfig] = useState<any>(null);
  const [customKeyId, setCustomKeyId] = useState<string>('');
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

  // Natural Language Prompt State
  const [agentPrompt, setAgentPrompt] = useState('Buy running shoes under ₹5,000');

  // Direct Order Form State
  const [rzpAmount, setRzpAmount] = useState('1500');
  const [rzpCategory, setRzpCategory] = useState('footwear');
  const [rzpPurpose, setRzpPurpose] = useState('running shoes');
  const [rzpReceipt, setRzpReceipt] = useState('');
  const [rzpLookupId, setRzpLookupId] = useState('');
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Integration SDK Language
  const [codeLang, setCodeLang] = useState<'python' | 'curl' | 'node' | 'langchain'>('python');

  // Refresh Session Data, Audits, Health
  const refreshData = useCallback(async () => {
    try {
      const [sess, audit, txns, approvals, health, pConfig] = await Promise.all([
        createOrInitSession(sessionId),
        fetchAuditEvents(sessionId, undefined, undefined, 50),
        fetchTransactions(sessionId, undefined, 50),
        fetchApprovals(sessionId, 'PENDING', 20),
        fetchHealth().catch(() => ({ status: 'offline' })),
        fetchPaymentConfig().catch(() => null)
      ]);
      setSession(sess);
      setAuditEvents(audit.items);
      setTransactions(txns.items);
      setPendingApprovals(approvals.items);
      setSystemHealth(health);
      setPaymentConfig(pConfig);
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

  const getEffectiveKeyId = () => {
    return customKeyId.trim() || paymentConfig?.key_id || DEFAULT_TEST_KEY;
  };

  // Launch Official Razorpay Standard Checkout Modal
  const launchRazorpayCheckout = (orderId?: string, amountInRupees?: number) => {
    const keyId = getEffectiveKeyId();
    const amount = (amountInRupees || createdOrder?.amount || parseInt(rzpAmount, 10) || 1500) * 100;

    if (!window.Razorpay) {
      alert('Razorpay Checkout SDK is still loading. Please verify internet connectivity.');
      return;
    }

    // Only pass order_id if it is a genuine Razorpay server order matching keyId
    const hasRealServerOrder = Boolean(
      orderId &&
      orderId.startsWith('order_') &&
      !orderId.includes('test') &&
      !orderId.includes('mock') &&
      paymentConfig?.key_id === keyId
    );

    const options: Record<string, any> = {
      key: keyId,
      amount: amount,
      currency: 'INR',
      name: 'AgentShield Rails',
      description: 'Authorized Autonomous AI Transaction Checkout',
      image: 'https://cdn.razorpay.com/static/assets/logo/rzp.svg',
      prefill: {
        name: 'AI Agent Operator',
        email: 'operator@agentshield.dev',
        contact: '9999999999',
      },
      notes: {
        session_id: sessionId,
        authorized_by: 'AgentShield Kernel',
      },
      theme: {
        color: '#006fee',
      },
      handler: async function (response: any) {
        try {
          const verifyRes = await verifyPayment({
            session_id: sessionId,
            razorpay_order_id: response.razorpay_order_id || orderId || `order_${Date.now()}`,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature || 'test_signature',
            transaction_id: lastResult?.execution?.transaction_id || lastResult?.transaction_id,
          });
          setPaymentStatus(`Payment Succeeded via Razorpay (${verifyRes.payment_id})`);
          await refreshData();
        } catch (e: any) {
          setPaymentStatus(`Payment Succeeded on Razorpay (${response.razorpay_payment_id})`);
          await refreshData();
        }
      },
      modal: {
        ondismiss: function () {
          console.log('Razorpay modal dismissed');
        },
      },
    };

    if (hasRealServerOrder) {
      options.order_id = orderId;
    }

    try {
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (resp: any) {
        setPaymentStatus(`Payment Failed: ${resp.error?.description || 'Transaction declined'}`);
      });
      rzp.open();
    } catch (err: any) {
      alert(`Could not launch Razorpay Checkout: ${err.message}`);
    }
  };

  // Run Agent Pipeline (Natural Language -> NIM -> AgentShield -> Razorpay)
  const handleAgentRun = async (promptToRun?: string) => {
    const text = promptToRun || agentPrompt;
    if (!text.trim()) return;
    setLoading(true);
    setPaymentStatus(null);
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
    setPaymentStatus(null);
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

  // Lookup Order in Razorpay API
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

  const handleScenarioRun = async (toolName: string, args: Record<string, any>) => {
    setLoading(true);
    setPaymentStatus(null);
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
    setPaymentStatus(null);
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
  const createdOrder = lastResult?.execution?.provider_result?.order || lastResult?.provider_result?.order;

  return (
    <div className="min-h-screen bg-[#030712] text-[#f8fafc] flex flex-col font-sans antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Top Navbar */}
      <header className="border-b border-white/[0.07] bg-[#030712]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shadow-[0_0_12px_rgba(99,102,241,0.5)]">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm tracking-tight text-white">AgentShield</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                v1.0
              </span>
            </div>
          </div>

          {/* Navigation Controls */}
          <nav className="flex items-center gap-1 bg-[#0b0f19] p-1 rounded-lg border border-white/[0.08] text-xs font-medium">
            <button
              onClick={() => setActiveTab('reactor')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'reactor'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Interception Deck
            </button>
            <button
              onClick={() => setActiveTab('razorpay')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'razorpay'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Razorpay Rails
            </button>
            <button
              onClick={() => setActiveTab('scenarios')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'scenarios'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Security Lab
            </button>
            <button
              onClick={() => setActiveTab('sdk')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'sdk'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Integration SDK
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'audit'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Ledger ({auditEvents.length})
            </button>
          </nav>

          {/* Session & Key Manager */}
          <div className="flex items-center gap-2 text-xs font-mono">
            <button
              onClick={() => setShowKeyModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0b0f19] hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 transition"
              title="Razorpay API Key"
            >
              <Key className="w-3 h-3 text-indigo-400" />
              <span>{getEffectiveKeyId().slice(0, 10)}...</span>
            </button>

            <div className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0b0f19] border border-white/[0.08] text-zinc-400">
              <span>session:</span>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="bg-transparent text-white font-mono text-xs w-20 focus:outline-none focus:text-indigo-400"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Razorpay Key Configuration Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="console-card w-full max-w-md p-6 space-y-4 shadow-2xl border border-white/[0.15]">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Key className="w-4 h-4 text-indigo-400" />
                <span>Razorpay Test Sandbox Key</span>
              </div>
              <button
                onClick={() => setShowKeyModal(false)}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              Razorpay standard checkout uses your test key to open the official modal with UPI, Cards, Netbanking and Wallets.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-zinc-400 block">Key ID</label>
              <input
                type="text"
                value={customKeyId}
                onChange={(e) => setCustomKeyId(e.target.value)}
                placeholder={DEFAULT_TEST_KEY}
                className="w-full console-input px-3 py-2 text-xs font-mono text-white"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                onClick={() => {
                  setCustomKeyId('');
                  setShowKeyModal(false);
                }}
                className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-xs font-mono text-zinc-400"
              >
                Reset Default
              </button>
              <button
                onClick={() => setShowKeyModal(false)}
                className="btn-primary px-4 py-1.5 text-xs font-mono"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto px-6 py-6 flex-1 w-full space-y-6">
        {/* Metric Ribbon */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
          <div className="console-card p-4 space-y-1.5">
            <div className="text-zinc-500 text-[11px] flex justify-between">
              <span>SESSION SPEND</span>
              <span>{spendPercent}%</span>
            </div>
            <div className="text-xl font-bold text-white tabular-nums tracking-tight">
              ₹{session?.total_active_spend.toLocaleString() ?? '0'}
            </div>
            <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
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
            <div className="text-[10px] text-zinc-500 flex justify-between">
              <span>Cap: ₹{session?.policy?.max_session_spend?.toLocaleString() ?? '10,000'}</span>
              <span>Settled: ₹{session?.committed_spend.toLocaleString() ?? 0}</span>
            </div>
          </div>

          <div className="console-card p-4 space-y-1.5">
            <div className="text-zinc-500 text-[11px]">AUTHORIZED CATEGORY</div>
            <div className="text-sm font-bold text-white truncate font-sans">
              {session?.intent?.category || 'footwear'}
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              Purpose: {session?.intent?.purpose || 'running shoes'}
            </div>
            <div className="text-[10px] text-zinc-500">
              Txn Limit: ₹{session?.policy?.max_transaction_amount?.toLocaleString() ?? '5,000'}
            </div>
          </div>

          <div className="console-card p-4 space-y-1.5">
            <div className="text-zinc-500 text-[11px]">REVIEW THRESHOLD</div>
            <div className="text-sm font-bold text-amber-300">
              {session?.policy?.require_approval_above ? `> ₹${session.policy.require_approval_above.toLocaleString()}` : 'Disabled'}
            </div>
            <div className="text-[11px] text-zinc-400">
              Holds spend in PENDING
            </div>
            <div className="text-[10px] text-zinc-500">
              Atomic spend lock
            </div>
          </div>

          <div className="console-card p-4 space-y-1.5">
            <div className="text-zinc-500 text-[11px]">VELOCITY WINDOW</div>
            <div className="text-sm font-bold text-white">
              {session?.policy?.max_requests_per_window ?? 4} req / 60s
            </div>
            <div className="text-[11px] text-zinc-400">
              Sliding Rate Limit
            </div>
            <div className="text-[10px] text-zinc-500">
              Burst cap: ₹{session?.policy?.max_spend_per_window?.toLocaleString() ?? '10,000'}
            </div>
          </div>
        </section>

        {/* Human Operator Review Alert */}
        {pendingApprovals.length > 0 && (
          <section className="console-card p-5 border-amber-500/30 bg-amber-500/[0.03] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <UserCheck className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-300 font-mono">
                  OPERATOR AUTHORIZATION REQUIRED ({pendingApprovals.length} IN-FLIGHT)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pendingApprovals.map((appr: ApprovalRecord) => (
                <div
                  key={appr.approval_id}
                  className="p-3.5 rounded-lg bg-[#030712] border border-amber-500/25 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1 text-xs font-mono">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-amber-400 font-bold">APPROVAL_PENDING</span>
                      <span className="text-zinc-500">{appr.approval_id}</span>
                    </div>
                    <div className="text-sm font-bold text-white pt-0.5">
                      {appr.tool_name} — ₹{appr.amount?.toLocaleString() ?? 0} {appr.currency}
                    </div>
                    <div className="text-zinc-400 text-[11px]">
                      Args: {JSON.stringify(appr.arguments)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-900">
                    <button
                      onClick={() => handleApprove(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="btn-primary flex-1 py-1.5 text-xs flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Authorize & Execute
                    </button>
                    <button
                      onClick={() => handleReject(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 py-1.5 rounded-md text-xs font-medium transition flex items-center justify-center gap-1.5"
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

        {/* Tab 1: Interception Deck */}
        {activeTab === 'reactor' && (
          <section className="space-y-6">
            {/* Prompt Dispatcher */}
            <div className="console-card p-5 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                <span className="flex items-center gap-1.5 text-white font-medium">
                  <Bot className="w-3.5 h-3.5 text-indigo-400" />
                  Agent Interceptor Command Deck
                </span>
                <span>Active Model: {systemHealth?.model || 'meta/llama-3.1-8b-instruct'}</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAgentRun()}
                  placeholder="Dispatch autonomous agent task..."
                  className="flex-1 console-input px-3.5 py-2.5 text-xs font-mono placeholder:text-zinc-600"
                />
                <button
                  onClick={() => handleAgentRun()}
                  disabled={loading || !agentPrompt.trim()}
                  className="btn-primary px-5 py-2.5 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{loading ? 'Evaluating...' : 'Dispatch'}</span>
                </button>
              </div>

              {/* One-Click Test Payloads */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                <span className="text-zinc-500">Quick Test:</span>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹1,500');
                    void handleAgentRun('Buy running shoes for ₹1,500');
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-900/90 border border-emerald-500/30 text-emerald-300 hover:bg-zinc-800 transition"
                >
                  ✓ Valid Order: Shoes ₹1,500
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy ₹4,999 Amazon gift card');
                    void handleAgentRun('Buy ₹4,999 Amazon gift card');
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-900/90 border border-rose-500/30 text-rose-300 hover:bg-zinc-800 transition"
                >
                  ✗ Prompt Injection: Gift Card ₹4,999
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹4,500');
                    void handleAgentRun('Buy running shoes for ₹4,500');
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-900/90 border border-amber-500/30 text-amber-300 hover:bg-zinc-800 transition"
                >
                  ⚠ Review Threshold: Shoes ₹4,500
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Payout ₹8,000 to vendor');
                    void handleAgentRun('Payout ₹8,000 to vendor');
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-900/90 border border-rose-500/30 text-rose-300 hover:bg-zinc-800 transition"
                >
                  ✗ Restricted Tool: create_payout
                </button>
              </div>
            </div>

            {/* Execution Trace & Razorpay Standard Modal Trigger */}
            {lastResult && (
              <div className="console-card p-5 space-y-5">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-mono text-zinc-400 uppercase">Decision:</span>
                    <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                      lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}>
                      {lastResult.decision || lastResult.execution?.decision}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-zinc-500">
                    TXN: {lastResult.execution?.transaction_id || lastResult.transaction_id || 'NONE'}
                  </span>
                </div>

                {/* 4 Pipeline Phases */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                  <div className="p-3.5 rounded-lg bg-[#030712] border border-white/[0.06] space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase">1. Intent Envelope</div>
                    <div className="text-white truncate">"{lastResult.user_prompt || agentPrompt}"</div>
                    <div className="text-zinc-500 text-[11px]">Category: {session?.intent?.category || 'footwear'}</div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#030712] border border-white/[0.06] space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase">2. Proposed Tool</div>
                    <div className="text-white font-bold truncate">
                      {lastResult.proposed_tool_name || lastResult.execution?.tool_name || 'create_order'}()
                    </div>
                    <div className="text-zinc-500 text-[11px]">
                      Amount: ₹{lastResult.proposed_arguments?.amount || lastResult.execution?.arguments?.amount || '—'}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#030712] border border-white/[0.06] space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase">3. Shield Guardrail</div>
                    <div className="text-white">
                      Risk: {lastResult.execution?.risk_level || lastResult.risk_level || 'LOW'}
                    </div>
                    <div className="text-zinc-400 text-[11px] truncate">
                      {lastResult.execution?.reasons?.length > 0
                        ? lastResult.execution.reasons.join(', ')
                        : 'Bounds Verified'}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-lg bg-[#030712] border border-white/[0.06] space-y-1">
                    <div className="text-[10px] text-zinc-500 uppercase">4. Razorpay Rails</div>
                    {createdOrder ? (
                      <div className="text-emerald-400 font-bold truncate">{createdOrder.id}</div>
                    ) : lastResult.execution?.decision === 'REVIEW' || lastResult.decision === 'REVIEW' ? (
                      <div className="text-amber-400 font-bold">Held in PENDING</div>
                    ) : (
                      <div className="text-rose-400 font-bold">Blocked</div>
                    )}
                    <div className="text-zinc-500 text-[11px]">
                      {createdOrder ? 'Order Ready' : 'Protected'}
                    </div>
                  </div>
                </div>

                {/* Razorpay Standard Checkout Launch Banner */}
                {createdOrder && (
                  <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-blue-300">
                        <CreditCard className="w-4 h-4 text-blue-400" />
                        <span>Razorpay Test Sandbox Order: {createdOrder.id}</span>
                      </div>
                      <p className="text-xs text-zinc-400 m-0">
                        Amount: <strong className="text-white">₹{createdOrder.amount?.toLocaleString() ?? 1500}</strong>. Launch Razorpay's authentic checkout modal with UPI, Cards, and Netbanking.
                      </p>
                    </div>

                    <button
                      onClick={() => launchRazorpayCheckout(createdOrder.id, createdOrder.amount)}
                      className="btn-rzp px-5 py-2 text-xs flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Razorpay Checkout</span>
                    </button>
                  </div>
                )}

                {/* Payment Feedback */}
                {paymentStatus && (
                  <div className={`p-3 rounded-lg text-xs font-mono flex items-center gap-2 ${
                    paymentStatus.includes('Successful') || paymentStatus.includes('Succeeded')
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                  }`}>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{paymentStatus}</span>
                  </div>
                )}

                {/* Explanation */}
                <div className={`p-3.5 rounded-lg border text-xs font-mono flex items-start gap-3 ${
                  lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}>
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 font-sans">
                    <div className="font-bold font-mono">
                      {lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'ALLOW: Transaction authorized and dispatched to payment provider.'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'REVIEW: Threshold breach. Spend reserved awaiting operator approval.'
                        : 'BLOCK: Unauthorized action prevented by AgentShield boundary.'}
                    </div>
                    <p className="text-zinc-300 m-0 text-xs">
                      {lastResult.execution?.policy_violations?.length > 0
                        ? `Policy Violations: ${lastResult.execution.policy_violations.map((v: any) => `${v.rule} (Limit: ${v.limit}, Actual: ${v.actual})`).join(', ')}`
                        : lastResult.execution?.reasons?.length > 0
                        ? `Reasons: ${lastResult.execution.reasons.join(', ')}`
                        : 'Action conforms with user authorized category, purpose, amount limit, and velocity bounds.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Razorpay Rails & Direct Checkout */}
        {activeTab === 'razorpay' && (
          <section className="space-y-6">
            {/* Direct Checkout Launcher */}
            <div className="console-card p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#006fee] flex items-center justify-center font-bold text-white">
                    ₹
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white m-0">Razorpay Standard Checkout Launcher</h3>
                    <p className="text-xs text-zinc-400 m-0">
                      Opens Razorpay's official checkout popup with live test credentials (UPI: success@razorpay, Card: 4111 1111 1111 1111)
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => launchRazorpayCheckout(undefined, parseInt(rzpAmount || '1500', 10))}
                  className="btn-rzp px-5 py-2.5 text-xs flex items-center gap-1.5"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Test Razorpay Checkout (₹{parseInt(rzpAmount || '1500', 10).toLocaleString()})</span>
                </button>
              </div>

              {paymentStatus && (
                <div className={`p-3 rounded-lg text-xs font-mono flex items-center gap-2 ${
                  paymentStatus.includes('Successful') || paymentStatus.includes('Succeeded')
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                }`}>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{paymentStatus}</span>
                </div>
              )}
            </div>

            {/* Direct Order Form & Lookup */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 console-card p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                  <span className="text-xs font-bold text-white font-mono">Create Razorpay Sandbox Order</span>
                  <span className="text-[10px] font-mono text-zinc-500">Auto Paise Conversion</span>
                </div>

                <form onSubmit={handleDirectRazorpayOrder} className="space-y-3 font-mono text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-zinc-400 block mb-1">Amount (INR ₹)</label>
                      <input
                        type="number"
                        value={rzpAmount}
                        onChange={(e) => setRzpAmount(e.target.value)}
                        required
                        className="w-full console-input px-3 py-2 text-white"
                        placeholder="1500"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Category</label>
                      <input
                        type="text"
                        value={rzpCategory}
                        onChange={(e) => setRzpCategory(e.target.value)}
                        required
                        className="w-full console-input px-3 py-2 text-white"
                        placeholder="footwear"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Purpose</label>
                      <input
                        type="text"
                        value={rzpPurpose}
                        onChange={(e) => setRzpPurpose(e.target.value)}
                        required
                        className="w-full console-input px-3 py-2 text-white"
                        placeholder="running shoes"
                      />
                    </div>
                    <div>
                      <label className="text-zinc-400 block mb-1">Receipt ID</label>
                      <input
                        type="text"
                        value={rzpReceipt}
                        onChange={(e) => setRzpReceipt(e.target.value)}
                        className="w-full console-input px-3 py-2 text-white"
                        placeholder="rcpt_1001"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-primary px-5 py-2 text-xs disabled:opacity-50"
                    >
                      Authorize & Create Order
                    </button>
                  </div>
                </form>
              </div>

              {/* Order Verifier */}
              <div className="console-card p-5 space-y-4 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-white font-mono block mb-2">Order State Inspector</span>
                  <form onSubmit={handleLookupOrder} className="space-y-2">
                    <input
                      type="text"
                      value={rzpLookupId}
                      onChange={(e) => setRzpLookupId(e.target.value)}
                      placeholder="order_RzpTest123..."
                      className="w-full console-input px-3 py-2 text-xs font-mono text-white"
                    />
                    <button
                      type="submit"
                      disabled={lookupLoading || !rzpLookupId.trim()}
                      className="w-full bg-zinc-900 hover:bg-zinc-800 text-white py-2 rounded-md text-xs font-mono transition"
                    >
                      Fetch from Razorpay
                    </button>
                  </form>

                  {lookupResult && (
                    <div className="mt-3 p-3 rounded bg-black border border-white/[0.08] text-[11px] font-mono">
                      <pre className="text-indigo-300 overflow-x-auto m-0">
                        {JSON.stringify(lookupResult.provider_result || lookupResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-white/[0.08] text-[11px] font-mono text-zinc-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Provider Mode:</span>
                    <span className="text-white">{isRazorpayActive ? 'Razorpay Sandbox' : 'Mock Fallback'}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Tab 3: Security Lab */}
        {activeTab === 'scenarios' && (
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white font-mono">Security Stress & Attack Matrix</h3>
              <p className="text-xs text-zinc-400 font-sans">
                Demonstrates how AgentShield defeats prompt injection and budgetary attacks.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
              <div className="console-card p-4 flex flex-col justify-between space-y-3 border-rose-500/30">
                <div>
                  <div className="text-[10px] text-rose-400 font-bold uppercase mb-1">Prompt Injection</div>
                  <h4 className="text-xs font-semibold text-white mb-1">1. Category Mismatch</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
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
                  className="w-full bg-rose-600/80 hover:bg-rose-500 text-white py-1.5 rounded text-xs transition"
                >
                  Run Attack
                </button>
              </div>

              <div className="console-card p-4 flex flex-col justify-between space-y-3 border-amber-500/30">
                <div>
                  <div className="text-[10px] text-amber-400 font-bold uppercase mb-1">Human Gate</div>
                  <h4 className="text-xs font-semibold text-white mb-1">2. Threshold Review</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
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
                  className="w-full bg-amber-600/80 hover:bg-amber-500 text-white py-1.5 rounded text-xs transition"
                >
                  Run Scenario
                </button>
              </div>

              <div className="console-card p-4 flex flex-col justify-between space-y-3 border-rose-500/30">
                <div>
                  <div className="text-[10px] text-rose-400 font-bold uppercase mb-1">Budget Overrun</div>
                  <h4 className="text-xs font-semibold text-white mb-1">3. Aggregate Cap</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                    Attempt ₹8,000 order. Multiple purchases breach ₹10k session cap.
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
                  className="w-full bg-rose-600/80 hover:bg-rose-500 text-white py-1.5 rounded text-xs transition"
                >
                  Run Attack
                </button>
              </div>

              <div className="console-card p-4 flex flex-col justify-between space-y-3 border-indigo-500/30">
                <div>
                  <div className="text-[10px] text-indigo-400 font-bold uppercase mb-1">Velocity Burst</div>
                  <h4 className="text-xs font-semibold text-white mb-1">4. Sliding Window</h4>
                  <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                    5 consecutive orders fired rapidly. Violates sliding window rate limit.
                  </p>
                </div>
                <button
                  onClick={() => void handleVelocityBurst()}
                  disabled={loading}
                  className="w-full bg-indigo-600/80 hover:bg-indigo-500 text-white py-1.5 rounded text-xs transition"
                >
                  Run Burst
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Tab 4: Integration SDK */}
        {activeTab === 'sdk' && (
          <section className="console-card p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white font-mono">Pluggable Service Integration SDK</h3>
              <p className="text-xs text-zinc-400 font-sans">
                Any external autonomous AI agent routes tool execution through AgentShield via standard HTTP calls.
              </p>
            </div>

            <div className="flex items-center gap-2 border-b border-white/[0.08] pb-2 text-xs font-mono">
              <button
                onClick={() => setCodeLang('python')}
                className={`px-2.5 py-1 rounded transition ${codeLang === 'python' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
              >
                Python (requests)
              </button>
              <button
                onClick={() => setCodeLang('curl')}
                className={`px-2.5 py-1 rounded transition ${codeLang === 'curl' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
              >
                cURL
              </button>
              <button
                onClick={() => setCodeLang('node')}
                className={`px-2.5 py-1 rounded transition ${codeLang === 'node' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
              >
                TypeScript / Node.js
              </button>
              <button
                onClick={() => setCodeLang('langchain')}
                className={`px-2.5 py-1 rounded transition ${codeLang === 'langchain' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
              >
                LangChain Tool
              </button>
            </div>

            <div className="relative rounded-lg bg-black border border-white/[0.08] p-4 font-mono text-xs overflow-x-auto">
              <button
                onClick={() => {
                  const snippet = codeLang === 'python'
                    ? `import requests\n\n# External Agent submits tool request to AgentShield\nresponse = requests.post(\n    "http://localhost:8000/api/v1/agent/execute",\n    json={\n        "session_id": "shopper_01",\n        "tool_name": "create_order",\n        "arguments": {\n            "amount": 2999,\n            "currency": "INR",\n            "category": "footwear",\n            "purpose": "running shoes"\n        },\n        "agent_id": "my_autonomous_agent"\n    }\n)\nresult = response.json()\nif result["decision"] == "ALLOW":\n    print("Payment Authorized on Razorpay:", result["provider_result"]["order"]["id"])\nelse:\n    print("Blocked by AgentShield:", result["reasons"])`
                    : codeLang === 'curl'
                    ? `curl -X POST http://localhost:8000/api/v1/agent/execute \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "session_id": "shopper_01",\n    "tool_name": "create_order",\n    "arguments": {\n      "amount": 2999,\n      "currency": "INR",\n      "category": "footwear",\n      "purpose": "running shoes"\n    }\n  }'`
                    : codeLang === 'node'
                    ? `const response = await fetch("http://localhost:8000/api/v1/agent/execute", {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    session_id: "shopper_01",\n    tool_name: "create_order",\n    arguments: { amount: 2999, currency: "INR", category: "footwear", purpose: "running shoes" }\n  })\n});\nconst result = await response.json();\nconsole.log(result.decision);`
                    : `from langchain.tools import tool\nimport requests\n\n@tool\ndef create_order(amount: int, category: str, purpose: str):\n    """Create order securely through AgentShield financial firewall."""\n    res = requests.post(\n        "http://localhost:8000/api/v1/agent/execute",\n        json={"session_id": "agent_session", "tool_name": "create_order", "arguments": {"amount": amount, "category": category, "purpose": purpose}}\n    )\n    return res.json()`;
                  copyToClipboard(snippet);
                }}
                className="absolute right-3 top-3 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white text-xs flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedText ? 'Copied' : 'Copy'}</span>
              </button>

              <pre className="m-0 leading-relaxed text-indigo-300">
                {codeLang === 'python' && `import requests

# Submit tool request to AgentShield Kernel
response = requests.post(
    "http://localhost:8000/api/v1/agent/execute",
    json={
        "session_id": "shopper_01",
        "tool_name": "create_order",
        "arguments": {
            "amount": 2999,
            "currency": "INR",
            "category": "footwear",
            "purpose": "running shoes"
        },
        "agent_id": "procurement_agent"
    }
)

result = response.json()
if result["decision"] == "ALLOW":
    print("Authorized on Razorpay:", result["provider_result"]["order"]["id"])
else:
    print("Blocked by AgentShield:", result["reasons"])`}

                {codeLang === 'curl' && `curl -X POST http://localhost:8000/api/v1/agent/execute \\
  -H "Content-Type: application/json" \\
  -d '{
    "session_id": "shopper_01",
    "tool_name": "create_order",
    "arguments": {
      "amount": 2999,
      "currency": "INR",
      "category": "footwear",
      "purpose": "running shoes"
    }
  }'`}

                {codeLang === 'node' && `const res = await fetch("http://localhost:8000/api/v1/agent/execute", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    session_id: "shopper_01",
    tool_name: "create_order",
    arguments: { amount: 2999, currency: "INR", category: "footwear", purpose: "running shoes" }
  })
});
const data = await res.json();`}

                {codeLang === 'langchain' && `from langchain.tools import tool
import requests

@tool
def create_order(amount: int, category: str, purpose: str):
    """Create order securely through AgentShield financial firewall."""
    res = requests.post(
        "http://localhost:8000/api/v1/agent/execute",
        json={"session_id": "agent_session", "tool_name": "create_order", "arguments": {"amount": amount, "category": category, "purpose": purpose}}
    )
    return res.json()`}
              </pre>
            </div>
          </section>
        )}

        {/* Tab 5: Audit Ledger */}
        {activeTab === 'audit' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white font-mono">Immutable Audit Ledger</h3>
                <p className="text-xs text-zinc-400 font-sans">Tamper-evident record of all evaluations, authorizations and blocks.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleResetSpend}
                  className="px-3 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 text-xs font-mono transition flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Spend
                </button>
                <button
                  onClick={handleReconcile}
                  className="px-3 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-zinc-300 text-xs font-mono transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reconcile
                </button>
              </div>
            </div>

            <div className="console-card overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#0b0f19] text-zinc-400 border-b border-white/[0.08] text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Decision</th>
                    <th className="py-3 px-4">Risk Level</th>
                    <th className="py-3 px-4">Tool</th>
                    <th className="py-3 px-4">Reasons</th>
                    <th className="py-3 px-4">Transaction</th>
                    <th className="py-3 px-4 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {auditEvents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-zinc-500 font-sans">
                        No audit events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    auditEvents.map((event: AuditEvent) => (
                      <tr
                        key={event.event_id}
                        onClick={() => setSelectedEvent(event)}
                        className="hover:bg-zinc-900/50 transition cursor-pointer"
                      >
                        <td className="py-3 px-4 text-zinc-400 whitespace-nowrap">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
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
                        <td className="py-3 px-4 whitespace-nowrap text-zinc-300">
                          {event.risk_level || 'LOW'} ({event.risk_score.toFixed(2)})
                        </td>
                        <td className="py-3 px-4 text-zinc-200">{event.tool_name}</td>
                        <td className="py-3 px-4 text-zinc-400 font-sans text-xs">
                          {event.reasons.length > 0 ? (
                            <span className="text-rose-400">{event.reasons.join(', ')}</span>
                          ) : (
                            <span className="text-emerald-400 font-mono">OK</span>
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
                            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
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

      {/* Audit Detail Modal Drawer */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="console-card w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-white/[0.15]">
            <div className="p-4 border-b border-white/[0.08] flex items-center justify-between bg-[#0b0f19]">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-zinc-500">Event:</span>
                <span className="text-white font-semibold">{selectedEvent.event_id}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(JSON.stringify(selectedEvent, null, 2))}
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white text-xs flex items-center gap-1 font-mono"
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

            <div className="p-5 overflow-y-auto space-y-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3 bg-black p-3.5 rounded border border-white/[0.08]">
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
                <div className="text-zinc-500 uppercase text-[10px] mb-1 font-bold">Raw Audit Payload</div>
                <pre className="bg-black p-3.5 rounded border border-white/[0.08] text-indigo-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/[0.06] bg-[#030712] px-6 py-4 text-center text-xs font-mono text-zinc-600 mt-auto">
        AgentShield · The agent may request an action. The agent never authorizes its own action.
      </footer>
    </div>
  );
}
