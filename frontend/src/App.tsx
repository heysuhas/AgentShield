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
  X,
  Send,
  Bot,
  Copy,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  Info,
  Smartphone,
  Building2,
  Wallet,
  Check
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

type Tab = 'agent' | 'razorpay' | 'scenarios' | 'audit' | 'integration';
type PaymentMethod = 'upi' | 'card' | 'netbanking' | 'wallet';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('agent');
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION_ID);
  const [session, setSession] = useState<SessionData | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [, setTransactions] = useState<Transaction[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRecord[]>([]);
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [paymentConfig, setPaymentConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);

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

  // Razorpay Interactive Payment Component State
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('upi');
  const [testUpiId, setTestUpiId] = useState('success@razorpay');
  const [testCardNumber, setTestCardNumber] = useState('4111 1111 1111 1111');
  const [testCardExpiry, setTestCardExpiry] = useState('12/30');
  const [testCardCvv, setTestCardCvv] = useState('123');
  const [testBank, setTestBank] = useState('HDFC');
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  // Integration Snippet Language
  const [codeLang, setCodeLang] = useState<'python' | 'curl' | 'node' | 'langchain'>('python');

  // Load session, audit log, approvals, and payment configuration
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

  // Execute Agent Request (Natural Language -> NIM -> AgentShield -> Razorpay)
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

  // Complete Payment via Standard Razorpay Checkout Modal or Direct Signature Simulator
  const handleProcessRazorpayPayment = async (orderIdToPay?: string, amountToPay?: number) => {
    const orderId = orderIdToPay || createdOrder?.id || `order_test_${Date.now().toString().slice(-6)}`;
    const finalAmount = amountToPay || createdOrder?.amount || parseInt(rzpAmount, 10) || 1500;
    const amountInPaise = finalAmount * 100;
    const keyId = paymentConfig?.key_id || 'rzp_test_1DP5mmOlF5G5ag';

    setPaymentProcessing(true);
    setPaymentStatus(null);

    // If Razorpay checkout.js script loaded and valid key available, launch standard popup
    if (window.Razorpay && paymentConfig?.key_id) {
      const options = {
        key: keyId,
        amount: amountInPaise,
        currency: 'INR',
        name: 'AgentShield Rails',
        description: `Autonomous Transaction: ${orderId}`,
        order_id: orderId.startsWith('order_') && !orderId.includes('test') ? orderId : undefined,
        image: 'https://cdn.razorpay.com/static/assets/logo/rzp.svg',
        prefill: {
          name: 'AI Agent User',
          email: 'user@agentshield.dev',
          contact: '9999999999',
        },
        theme: { color: '#006fee' },
        handler: async function (response: any) {
          try {
            const verifyRes = await verifyPayment({
              session_id: sessionId,
              razorpay_order_id: response.razorpay_order_id || orderId,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              transaction_id: lastResult?.execution?.transaction_id || lastResult?.transaction_id,
            });
            setPaymentStatus(`Payment Succeeded (${verifyRes.payment_id})`);
            await refreshData();
          } catch (e: any) {
            setPaymentStatus(`Payment verification failed: ${e.message}`);
          } finally {
            setPaymentProcessing(false);
          }
        },
        modal: {
          ondismiss: function () {
            setPaymentProcessing(false);
          },
        },
      };

      try {
        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function (resp: any) {
          setPaymentStatus(`Payment Failed: ${resp.error.description}`);
          setPaymentProcessing(false);
        });
        rzp.open();
        return;
      } catch (err) {
        console.warn('Fallback to direct simulator verification', err);
      }
    }

    // Direct Sandbox Verification Simulator for immediate test payments
    try {
      const simulatedPaymentId = `pay_rzp_${Date.now().toString().slice(-8)}`;
      const verifyRes = await verifyPayment({
        session_id: sessionId,
        razorpay_order_id: orderId,
        razorpay_payment_id: simulatedPaymentId,
        razorpay_signature: 'test_signature',
        transaction_id: lastResult?.execution?.transaction_id || lastResult?.transaction_id,
      });
      setPaymentStatus(`Payment Succeeded via Razorpay Sandbox (${verifyRes.payment_id})`);
      await refreshData();
    } catch (e: any) {
      setPaymentStatus(`Payment failed: ${e.message}`);
    } finally {
      setPaymentProcessing(false);
    }
  };

  // 1-Click Scenario Runner
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
    <div className="min-h-screen bg-[#000000] text-[#ededed] flex flex-col font-sans selection:bg-blue-500/30 selection:text-blue-200 antialiased">
      {/* Floating Glassmorphic Header */}
      <header className="sticky top-0 z-50 pt-4 px-6 max-w-7xl mx-auto w-full">
        <div className="glass-panel px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 border border-white/[0.09] shadow-2xl">
          {/* Logo & Identity */}
          <div className="flex items-center gap-3.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-[0_0_20px_rgba(0,111,238,0.5)]">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-white">AgentShield</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/25">
                  STANDALONE SERVICE
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 m-0 hidden sm:block">
                The Trust Layer Between Autonomous AI and Money
              </p>
            </div>
          </div>

          {/* Navigation Pill Switcher */}
          <nav className="flex items-center gap-1.5 glass-pill px-2 py-1 text-xs font-medium">
            <button
              onClick={() => setActiveTab('agent')}
              className={`px-3 py-1.5 rounded-full transition ${
                activeTab === 'agent'
                  ? 'bg-white text-black font-semibold shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Agent Playground
            </button>
            <button
              onClick={() => setActiveTab('razorpay')}
              className={`px-3 py-1.5 rounded-full transition ${
                activeTab === 'razorpay'
                  ? 'bg-white text-black font-semibold shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Razorpay Rails & Gateway
            </button>
            <button
              onClick={() => setActiveTab('integration')}
              className={`px-3 py-1.5 rounded-full transition ${
                activeTab === 'integration'
                  ? 'bg-white text-black font-semibold shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Integration SDK
            </button>
            <button
              onClick={() => setActiveTab('scenarios')}
              className={`px-3 py-1.5 rounded-full transition ${
                activeTab === 'scenarios'
                  ? 'bg-white text-black font-semibold shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Security Lab
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-full transition ${
                activeTab === 'audit'
                  ? 'bg-white text-black font-semibold shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Audit ({auditEvents.length})
            </button>
          </nav>

          {/* Environment & Session Selector */}
          <div className="flex items-center gap-2.5 text-xs font-mono">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900/90 border border-white/[0.08] text-zinc-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{isRazorpayActive ? 'Razorpay Sandbox' : 'Sandbox Active'}</span>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-900/90 border border-white/[0.08]">
              <span className="text-zinc-500">session:</span>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="bg-transparent text-white font-mono text-xs w-24 focus:outline-none focus:text-blue-400 border-none p-0"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main App Container */}
      <main className="max-w-7xl mx-auto px-6 py-8 flex-1 w-full space-y-8">
        {/* Top Metric Strip & Financial Invariant */}
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="glass-panel p-5 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
              <span>ACTIVE SPEND</span>
              <span>{spendPercent}%</span>
            </div>
            <div className="text-2xl font-bold text-white tracking-tight">
              ₹{session?.total_active_spend.toLocaleString() ?? '0'}
            </div>
            <div className="w-full bg-zinc-850 h-1.5 rounded-full overflow-hidden">
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
            <div className="text-[11px] text-zinc-500 font-mono flex justify-between">
              <span>Cap: ₹{session?.policy?.max_session_spend?.toLocaleString() ?? '10,000'}</span>
              <span>Committed: ₹{session?.committed_spend.toLocaleString() ?? 0}</span>
            </div>
          </div>

          <div className="glass-panel p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
              <span>INTENT ENVELOPE</span>
              <span className="text-blue-400">ENFORCED</span>
            </div>
            <div className="text-base font-bold text-white truncate">
              {session?.intent?.category || 'footwear'}
            </div>
            <div className="text-xs text-zinc-400 truncate">
              Purpose: {session?.intent?.purpose || 'running shoes'}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">
              Max single txn: ₹{session?.policy?.max_transaction_amount?.toLocaleString() ?? '5,000'}
            </div>
          </div>

          <div className="glass-panel p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
              <span>HUMAN REVIEW GATE</span>
              <span className="text-amber-400 font-bold">ACTIVE</span>
            </div>
            <div className="text-2xl font-bold text-amber-300">
              {session?.policy?.require_approval_above ? `> ₹${session.policy.require_approval_above.toLocaleString()}` : 'Disabled'}
            </div>
            <div className="text-xs text-zinc-400">
              High-value orders hold in PENDING
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">
              Atomic spend reservation
            </div>
          </div>

          <div className="glass-panel p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
              <span>VELOCITY RATE LIMIT</span>
              <span className="text-zinc-300 font-mono">SLIDING</span>
            </div>
            <div className="text-2xl font-bold text-white">
              {session?.policy?.max_requests_per_window ?? 4} <span className="text-xs font-normal text-zinc-400">req / 60s</span>
            </div>
            <div className="text-xs text-zinc-400">
              Burst spend cap: ₹{session?.policy?.max_spend_per_window?.toLocaleString() ?? '10,000'}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono">
              Sliding-window durability
            </div>
          </div>
        </section>

        {/* Pending Operator Authorization Queue (If Any) */}
        {pendingApprovals.length > 0 && (
          <section className="glass-panel p-6 border border-amber-500/40 bg-amber-500/[0.04] space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-amber-300 m-0">
                    Operator Authorization Required ({pendingApprovals.length} In-Flight)
                  </h3>
                  <p className="text-xs text-zinc-400 m-0">
                    Spend is atomically reserved in PENDING status. Payment rails will not execute until an operator authorizes.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingApprovals.map((appr: ApprovalRecord) => (
                <div
                  key={appr.approval_id}
                  className="p-4 rounded-xl bg-black border border-amber-500/30 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-1 text-xs font-mono">
                    <div className="flex items-center justify-between">
                      <span className="text-amber-400 font-bold px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-[10px]">
                        REVIEW REQUIRED
                      </span>
                      <span className="text-zinc-500">{appr.approval_id}</span>
                    </div>
                    <div className="text-base font-bold text-white pt-1">
                      {appr.tool_name} — ₹{appr.amount?.toLocaleString() ?? 0} {appr.currency}
                    </div>
                    <div className="text-zinc-400 text-[11px]">
                      Arguments: {JSON.stringify(appr.arguments)}
                    </div>
                    <div className="text-amber-300 text-[11px]">
                      Trigger Reason: {appr.reasons.join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-900">
                    <button
                      onClick={() => handleApprove(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-white hover:bg-zinc-200 text-black font-semibold py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Authorize & Dispatch
                    </button>
                    <button
                      onClick={() => handleReject(appr.approval_id)}
                      disabled={reviewingId === appr.approval_id}
                      className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 font-medium py-2 px-3 rounded-lg text-xs transition flex items-center justify-center gap-1.5"
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

        {/* Tab 1: Live Agent Playground */}
        {activeTab === 'agent' && (
          <section className="space-y-6">
            {/* Natural Language Prompt Box */}
            <div className="glass-panel p-6 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <label className="font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Bot className="w-4 h-4 text-blue-400" />
                  Autonomous AI Agent Prompt Runner
                </label>
                <span className="font-mono text-zinc-400 text-[11px]">
                  Authorized Intent: footwear · max ₹5,000 · review threshold &gt;₹3,000
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={agentPrompt}
                    onChange={(e) => setAgentPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAgentRun()}
                    placeholder="Ask the AI agent (e.g. 'Buy running shoes under ₹5,000')..."
                    className="w-full glass-input px-4 py-3 text-sm font-mono placeholder:text-zinc-600 pr-10"
                  />
                  {agentPrompt && (
                    <button
                      onClick={() => setAgentPrompt('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => handleAgentRun()}
                  disabled={loading || !agentPrompt.trim()}
                  className="btn-primary-action px-6 py-3 text-xs flex items-center gap-2 shrink-0 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{loading ? 'Interception Running...' : 'Dispatch Agent'}</span>
                </button>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono pt-1">
                <span className="text-zinc-500">Quick Test Payloads:</span>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹1,500');
                    void handleAgentRun('Buy running shoes for ₹1,500');
                  }}
                  className="px-3 py-1 rounded-full bg-zinc-900 border border-emerald-500/30 text-emerald-300 hover:bg-zinc-800 transition"
                >
                  ✓ Valid Order: Shoes ₹1,500
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy ₹4,999 Amazon gift card');
                    void handleAgentRun('Buy ₹4,999 Amazon gift card');
                  }}
                  className="px-3 py-1 rounded-full bg-zinc-900 border border-rose-500/30 text-rose-300 hover:bg-zinc-800 transition"
                >
                  ✗ Prompt Injection: Gift Card ₹4,999
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Buy running shoes for ₹4,500');
                    void handleAgentRun('Buy running shoes for ₹4,500');
                  }}
                  className="px-3 py-1 rounded-full bg-zinc-900 border border-amber-500/30 text-amber-300 hover:bg-zinc-800 transition"
                >
                  ⚠ Review Gate: Shoes ₹4,500
                </button>
                <button
                  onClick={() => {
                    setAgentPrompt('Payout ₹8,000 to merchant');
                    void handleAgentRun('Payout ₹8,000 to merchant');
                  }}
                  className="px-3 py-1 rounded-full bg-zinc-900 border border-rose-500/30 text-rose-300 hover:bg-zinc-800 transition"
                >
                  ✗ Restricted Tool: create_payout
                </button>
              </div>
            </div>

            {/* Execution Trace State Machine */}
            {lastResult && (
              <div className="glass-panel p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono uppercase text-zinc-400">AgentShield Interceptor Result</span>
                    <span className={`px-3 py-0.5 rounded-full text-xs font-mono font-bold ${
                      lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    }`}>
                      {lastResult.decision || lastResult.execution?.decision || 'EVALUATED'}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-zinc-500">
                    TXN: {lastResult.execution?.transaction_id || lastResult.transaction_id || 'NONE'}
                  </span>
                </div>

                {/* 4 Steps Monochromatic Pipeline */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs font-mono">
                  {/* Step 1 */}
                  <div className="p-4 rounded-xl bg-black border border-white/[0.08] space-y-1.5">
                    <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">
                      1. User Authorized Intent
                    </div>
                    <div className="text-white font-sans text-xs truncate">
                      "{lastResult.user_prompt || agentPrompt}"
                    </div>
                    <div className="text-zinc-500 text-[11px]">
                      Intent: {session?.intent?.category || 'footwear'}
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="p-4 rounded-xl bg-black border border-white/[0.08] space-y-1.5">
                    <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                      2. NIM Model Proposal
                    </div>
                    <div className="text-white font-bold truncate">
                      {lastResult.proposed_tool_name || lastResult.execution?.tool_name || 'create_order'}()
                    </div>
                    <div className="text-zinc-500 text-[11px]">
                      Amount: ₹{lastResult.proposed_arguments?.amount || lastResult.execution?.arguments?.amount || '—'}
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="p-4 rounded-xl bg-black border border-white/[0.08] space-y-1.5">
                    <div className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">
                      3. Shield Guardrail
                    </div>
                    <div className="text-white font-bold">
                      Risk Level: {lastResult.execution?.risk_level || lastResult.risk_level || 'LOW'}
                    </div>
                    <div className="text-zinc-400 text-[11px] truncate">
                      {lastResult.execution?.reasons?.length > 0
                        ? lastResult.execution.reasons.join(', ')
                        : 'Bounds & Policy Passed'}
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="p-4 rounded-xl bg-black border border-white/[0.08] space-y-1.5">
                    <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                      4. Razorpay Sandbox Rails
                    </div>
                    {createdOrder ? (
                      <div className="text-emerald-400 font-bold truncate">
                        {createdOrder.id}
                      </div>
                    ) : lastResult.execution?.decision === 'REVIEW' || lastResult.decision === 'REVIEW' ? (
                      <div className="text-amber-400 font-bold">Held in PENDING</div>
                    ) : (
                      <div className="text-rose-400 font-bold">Execution Blocked</div>
                    )}
                    <div className="text-zinc-500 text-[11px]">
                      {createdOrder ? 'Order Created' : 'Provider Guarded'}
                    </div>
                  </div>
                </div>

                {/* Razorpay Standard Checkout Component (Embedded when Order is Ready) */}
                {createdOrder && (
                  <div className="rounded-2xl border border-blue-500/40 bg-gradient-to-b from-[#0a1226] to-[#040814] p-6 space-y-5 shadow-2xl">
                    {/* Header & Price Banner */}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-blue-500/20 pb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#006fee] flex items-center justify-center font-bold text-white shadow-lg">
                          ₹
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base text-white">Razorpay Checkout</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                              TEST MODE
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 m-0">Order ID: {createdOrder.id}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-2xl font-black text-white tracking-tight">
                          ₹{createdOrder.amount?.toLocaleString() ?? 1500}
                        </div>
                        <span className="text-[11px] text-zinc-400 font-mono">INR (Indian Rupee)</span>
                      </div>
                    </div>

                    {/* Selectable Payment Methods */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      {/* Left: Method Selector */}
                      <div className="space-y-1.5 font-mono text-xs">
                        <button
                          onClick={() => setSelectedMethod('upi')}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border transition ${
                            selectedMethod === 'upi'
                              ? 'bg-blue-600/20 border-blue-500 text-white font-bold'
                              : 'bg-black/40 border-white/[0.08] text-zinc-400 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <Smartphone className="w-4 h-4 text-blue-400" />
                            UPI / QR Code
                          </span>
                          {selectedMethod === 'upi' && <ChevronRight className="w-3.5 h-3.5 text-blue-400" />}
                        </button>

                        <button
                          onClick={() => setSelectedMethod('card')}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border transition ${
                            selectedMethod === 'card'
                              ? 'bg-blue-600/20 border-blue-500 text-white font-bold'
                              : 'bg-black/40 border-white/[0.08] text-zinc-400 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-blue-400" />
                            Cards (Credit/Debit)
                          </span>
                          {selectedMethod === 'card' && <ChevronRight className="w-3.5 h-3.5 text-blue-400" />}
                        </button>

                        <button
                          onClick={() => setSelectedMethod('netbanking')}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border transition ${
                            selectedMethod === 'netbanking'
                              ? 'bg-blue-600/20 border-blue-500 text-white font-bold'
                              : 'bg-black/40 border-white/[0.08] text-zinc-400 hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-blue-400" />
                            Netbanking
                          </span>
                          {selectedMethod === 'netbanking' && <ChevronRight className="w-3.5 h-3.5 text-blue-400" />}
                        </button>
                      </div>

                      {/* Right: Method Configuration Details */}
                      <div className="md:col-span-2 p-4 rounded-xl bg-black/60 border border-white/[0.08] flex flex-col justify-between space-y-4">
                        {selectedMethod === 'upi' && (
                          <div className="space-y-3 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-zinc-400 font-mono">Test UPI Virtual Payment Address (VPA):</span>
                              <span className="text-emerald-400 font-mono text-[11px] font-bold">Auto-Success</span>
                            </div>
                            <input
                              type="text"
                              value={testUpiId}
                              onChange={(e) => setTestUpiId(e.target.value)}
                              className="w-full glass-input px-3 py-2 text-xs font-mono text-white"
                            />
                            <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                              <button
                                onClick={() => setTestUpiId('success@razorpay')}
                                className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white"
                              >
                                success@razorpay
                              </button>
                              <button
                                onClick={() => setTestUpiId('failure@razorpay')}
                                className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white"
                              >
                                failure@razorpay
                              </button>
                            </div>
                          </div>
                        )}

                        {selectedMethod === 'card' && (
                          <div className="space-y-3 text-xs font-mono">
                            <div>
                              <span className="text-zinc-400 block mb-1">Test Card Number:</span>
                              <input
                                type="text"
                                value={testCardNumber}
                                onChange={(e) => setTestCardNumber(e.target.value)}
                                className="w-full glass-input px-3 py-2 text-xs text-white"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <span className="text-zinc-400 block mb-1">Expiry (MM/YY):</span>
                                <input
                                  type="text"
                                  value={testCardExpiry}
                                  onChange={(e) => setTestCardExpiry(e.target.value)}
                                  className="w-full glass-input px-3 py-2 text-xs text-white"
                                />
                              </div>
                              <div>
                                <span className="text-zinc-400 block mb-1">CVV:</span>
                                <input
                                  type="text"
                                  value={testCardCvv}
                                  onChange={(e) => setTestCardCvv(e.target.value)}
                                  className="w-full glass-input px-3 py-2 text-xs text-white"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {selectedMethod === 'netbanking' && (
                          <div className="space-y-2 text-xs">
                            <span className="text-zinc-400 font-mono block">Select Test Bank:</span>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono">
                              {['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak'].map((b) => (
                                <button
                                  key={b}
                                  onClick={() => setTestBank(b)}
                                  className={`p-2.5 rounded-lg border text-center transition ${
                                    testBank === b
                                      ? 'bg-blue-600/30 border-blue-400 text-white font-bold'
                                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                                  }`}
                                >
                                  {b} Bank
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Pay Action Button */}
                        <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                          <span className="text-[11px] text-zinc-400 font-mono">
                            Direct Razorpay Rails Settlement
                          </span>
                          <button
                            onClick={() => handleProcessRazorpayPayment(createdOrder.id, createdOrder.amount)}
                            disabled={paymentProcessing}
                            className="bg-[#006fee] hover:bg-blue-500 text-white font-bold px-6 py-2.5 rounded-xl text-xs flex items-center gap-2 shadow-lg transition disabled:opacity-50"
                          >
                            <CreditCard className="w-4 h-4" />
                            <span>
                              {paymentProcessing
                                ? 'Processing Razorpay...'
                                : `Pay ₹${createdOrder.amount?.toLocaleString() ?? 1500} Now`}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Payment Verification Feedback */}
                {paymentStatus && (
                  <div className={`p-4 rounded-xl text-xs font-mono flex items-center gap-2 ${
                    paymentStatus.includes('Succeeded')
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                  }`}>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{paymentStatus}</span>
                  </div>
                )}

                {/* Plain-English Decision Reason */}
                <div className={`p-4 rounded-xl border text-xs font-mono flex items-start gap-3.5 ${
                  lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                }`}>
                  <Info className="w-5 h-5 shrink-0 mt-0.5" />
                  <div className="space-y-1 font-sans">
                    <div className="font-bold text-sm font-mono">
                      {lastResult.decision === 'ALLOW' || lastResult.execution?.decision === 'ALLOW'
                        ? 'ALLOW: Transaction authorized and dispatched to Razorpay.'
                        : lastResult.decision === 'REVIEW' || lastResult.execution?.decision === 'REVIEW'
                        ? 'REVIEW: Transaction exceeds operator threshold. Spend reserved awaiting human sign-off.'
                        : 'BLOCK: Operation prevented by AgentShield boundary.'}
                    </div>
                    <p className="text-zinc-300 leading-relaxed m-0 text-xs">
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
          </section>
        )}

        {/* Tab 2: Direct Razorpay Rails & Gateway Component */}
        {activeTab === 'razorpay' && (
          <section className="space-y-6">
            {/* Embedded Live Razorpay Gateway Simulator Component */}
            <div className="rounded-3xl border border-blue-500/40 bg-gradient-to-b from-[#091124] to-[#000000] p-6 lg:p-8 space-y-6 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-blue-500/20 pb-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-[#006fee] flex items-center justify-center font-bold text-xl text-white shadow-[0_0_25px_rgba(0,111,238,0.6)]">
                    ₹
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-white m-0">Razorpay Payment Gateway Component</h2>
                      <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        OFFICIAL TEST SANDBOX
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 m-0">
                      Standard Checkout simulation for UPI, Credit Cards, Netbanking & Wallets with Razorpay test credentials
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 bg-black/80 px-4 py-2 rounded-2xl border border-white/[0.08]">
                  <div className="text-right font-mono">
                    <span className="text-[10px] text-zinc-400 block">CHECKOUT AMOUNT</span>
                    <span className="text-xl font-bold text-white">₹{parseInt(rzpAmount || '1500', 10).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Payment Methods Tabs & Selector */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Method Navigation List */}
                <div className="space-y-2 font-mono text-xs">
                  <button
                    onClick={() => setSelectedMethod('upi')}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition ${
                      selectedMethod === 'upi'
                        ? 'bg-[#006fee]/20 border-blue-500 text-white font-bold shadow-lg'
                        : 'bg-black/50 border-white/[0.08] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Smartphone className="w-5 h-5 text-blue-400" />
                      <div className="text-left">
                        <div className="text-sm">UPI / QR</div>
                        <span className="text-[10px] text-zinc-500">Google Pay, PhonePe, Paytm, VPA</span>
                      </div>
                    </div>
                    {selectedMethod === 'upi' && <ChevronRight className="w-4 h-4 text-blue-400" />}
                  </button>

                  <button
                    onClick={() => setSelectedMethod('card')}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition ${
                      selectedMethod === 'card'
                        ? 'bg-[#006fee]/20 border-blue-500 text-white font-bold shadow-lg'
                        : 'bg-black/50 border-white/[0.08] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <CreditCard className="w-5 h-5 text-blue-400" />
                      <div className="text-left">
                        <div className="text-sm">Card</div>
                        <span className="text-[10px] text-zinc-500">Visa, Mastercard, RuPay</span>
                      </div>
                    </div>
                    {selectedMethod === 'card' && <ChevronRight className="w-4 h-4 text-blue-400" />}
                  </button>

                  <button
                    onClick={() => setSelectedMethod('netbanking')}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition ${
                      selectedMethod === 'netbanking'
                        ? 'bg-[#006fee]/20 border-blue-500 text-white font-bold shadow-lg'
                        : 'bg-black/50 border-white/[0.08] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Building2 className="w-5 h-5 text-blue-400" />
                      <div className="text-left">
                        <div className="text-sm">Netbanking</div>
                        <span className="text-[10px] text-zinc-500">All Major Indian Banks</span>
                      </div>
                    </div>
                    {selectedMethod === 'netbanking' && <ChevronRight className="w-4 h-4 text-blue-400" />}
                  </button>

                  <button
                    onClick={() => setSelectedMethod('wallet')}
                    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition ${
                      selectedMethod === 'wallet'
                        ? 'bg-[#006fee]/20 border-blue-500 text-white font-bold shadow-lg'
                        : 'bg-black/50 border-white/[0.08] text-zinc-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Wallet className="w-5 h-5 text-blue-400" />
                      <div className="text-left">
                        <div className="text-sm">Wallets</div>
                        <span className="text-[10px] text-zinc-500">Amazon Pay, Paytm, Mobikwik</span>
                      </div>
                    </div>
                    {selectedMethod === 'wallet' && <ChevronRight className="w-4 h-4 text-blue-400" />}
                  </button>
                </div>

                {/* Method Input Details */}
                <div className="lg:col-span-2 p-6 rounded-2xl bg-black/80 border border-white/[0.08] flex flex-col justify-between space-y-6">
                  {selectedMethod === 'upi' && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-zinc-300">Enter UPI ID / VPA</span>
                        <span className="text-[11px] font-mono text-emerald-400">Verified Test VPA</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={testUpiId}
                          onChange={(e) => setTestUpiId(e.target.value)}
                          className="flex-1 glass-input px-4 py-3 text-sm font-mono text-white"
                          placeholder="success@razorpay"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-mono">
                        <button
                          onClick={() => setTestUpiId('success@razorpay')}
                          className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          success@razorpay
                        </button>
                        <button
                          onClick={() => setTestUpiId('failure@razorpay')}
                          className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white flex items-center gap-1.5"
                        >
                          <X className="w-3.5 h-3.5 text-rose-400" />
                          failure@razorpay
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedMethod === 'card' && (
                    <div className="space-y-4 font-mono text-xs">
                      <div>
                        <span className="text-zinc-400 block mb-1">Card Number</span>
                        <input
                          type="text"
                          value={testCardNumber}
                          onChange={(e) => setTestCardNumber(e.target.value)}
                          className="w-full glass-input px-4 py-3 text-sm text-white"
                          placeholder="4111 1111 1111 1111"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-zinc-400 block mb-1">Valid Thru (MM/YY)</span>
                          <input
                            type="text"
                            value={testCardExpiry}
                            onChange={(e) => setTestCardExpiry(e.target.value)}
                            className="w-full glass-input px-4 py-3 text-sm text-white"
                            placeholder="12/30"
                          />
                        </div>
                        <div>
                          <span className="text-zinc-400 block mb-1">CVV</span>
                          <input
                            type="text"
                            value={testCardCvv}
                            onChange={(e) => setTestCardCvv(e.target.value)}
                            className="w-full glass-input px-4 py-3 text-sm text-white"
                            placeholder="123"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {selectedMethod === 'netbanking' && (
                    <div className="space-y-3 font-mono text-xs">
                      <span className="text-zinc-400 block">Popular Test Banks</span>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {['HDFC', 'ICICI', 'SBI', 'Axis', 'Kotak', 'PNB'].map((bank) => (
                          <button
                            key={bank}
                            onClick={() => setTestBank(bank)}
                            className={`p-3 rounded-xl border text-center transition ${
                              testBank === bank
                                ? 'bg-blue-600/30 border-blue-400 text-white font-bold shadow-md'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                            }`}
                          >
                            {bank} Bank
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedMethod === 'wallet' && (
                    <div className="space-y-3 font-mono text-xs">
                      <span className="text-zinc-400 block">Select Digital Wallet</span>
                      <div className="grid grid-cols-2 gap-3">
                        {['Amazon Pay', 'Paytm Wallet', 'Mobikwik', 'Freecharge'].map((w) => (
                          <button
                            key={w}
                            className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white text-center"
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Payment Verification Status */}
                  {paymentStatus && (
                    <div className={`p-4 rounded-xl text-xs font-mono flex items-center gap-2 ${
                      paymentStatus.includes('Succeeded')
                        ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-500/15 border border-rose-500/40 text-rose-300'
                    }`}>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{paymentStatus}</span>
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="pt-4 border-t border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-zinc-400 font-mono">
                      Simulates authentic Razorpay webhook / verify HMAC signature
                    </div>
                    <button
                      onClick={() => handleProcessRazorpayPayment()}
                      disabled={paymentProcessing}
                      className="bg-[#006fee] hover:bg-blue-500 text-white font-bold px-8 py-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-[0_0_25px_rgba(0,111,238,0.5)] transition disabled:opacity-50"
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>
                        {paymentProcessing
                          ? 'Settling on Razorpay...'
                          : `Pay ₹${parseInt(rzpAmount || '1500', 10).toLocaleString()} with Razorpay`}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Direct Order Form & Lookup Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Direct Order Dispatch Form */}
              <div className="lg:col-span-2 glass-panel p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">Direct Razorpay Sandbox Order Dispatch</h3>
                    <p className="text-xs text-zinc-400">Create test orders directly on Razorpay through AgentShield authorization</p>
                  </div>
                  <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-blue-300">
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
                        className="w-full glass-input px-3.5 py-2.5 text-xs font-mono text-white"
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
                        className="w-full glass-input px-3.5 py-2.5 text-xs font-mono text-white"
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
                        className="w-full glass-input px-3.5 py-2.5 text-xs font-mono text-white"
                        placeholder="running shoes"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-400 mb-1.5 font-mono">Receipt Identifier</label>
                      <input
                        type="text"
                        value={rzpReceipt}
                        onChange={(e) => setRzpReceipt(e.target.value)}
                        className="w-full glass-input px-3.5 py-2.5 text-xs font-mono text-white"
                        placeholder="rcpt_custom_1001"
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
                      className="btn-primary-action px-6 py-2.5 text-xs disabled:opacity-50"
                    >
                      Create Razorpay Order
                    </button>
                  </div>
                </form>
              </div>

              {/* Order ID Verifier */}
              <div className="glass-panel p-6 space-y-4 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white mb-1">Verify Razorpay Order</h3>
                  <p className="text-xs text-zinc-400 mb-4">Query Razorpay Sandbox API to inspect settled order state.</p>

                  <form onSubmit={handleLookupOrder} className="space-y-3">
                    <input
                      type="text"
                      value={rzpLookupId}
                      onChange={(e) => setRzpLookupId(e.target.value)}
                      placeholder="order_RzpTest123..."
                      className="w-full glass-input px-3.5 py-2.5 text-xs font-mono text-white"
                    />
                    <button
                      type="submit"
                      disabled={lookupLoading || !rzpLookupId.trim()}
                      className="w-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white py-2.5 rounded-xl text-xs font-semibold transition"
                    >
                      Fetch Order Status
                    </button>
                  </form>

                  {lookupResult && (
                    <div className="mt-3 p-3.5 rounded-xl bg-black border border-zinc-800 text-[11px] font-mono space-y-1">
                      <div className="text-zinc-400">Order Payload:</div>
                      <pre className="text-blue-300 overflow-x-auto m-0">
                        {JSON.stringify(lookupResult.provider_result || lookupResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-zinc-800 text-[11px] font-mono text-zinc-400 space-y-1.5">
                  <div className="flex justify-between">
                    <span>Provider Mode:</span>
                    <span className="text-white font-medium">{isRazorpayActive ? 'Razorpay Sandbox' : 'Mock Provider'}</span>
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

        {/* Tab 3: Integration SDK & Pluggable Architecture */}
        {activeTab === 'integration' && (
          <section className="space-y-6">
            <div className="glass-panel p-6 space-y-4">
              <div>
                <h3 className="text-base font-bold text-white">Pluggable Service Architecture</h3>
                <p className="text-xs text-zinc-400">
                  AgentShield is a standalone authorization middleware. Any external AI agent (LangChain, CrewAI, AutoGen, or custom agents) calls AgentShield before executing payment operations.
                </p>
              </div>

              {/* Language Switcher */}
              <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 text-xs font-mono">
                <button
                  onClick={() => setCodeLang('python')}
                  className={`px-3 py-1 rounded-md transition ${codeLang === 'python' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
                >
                  Python (requests)
                </button>
                <button
                  onClick={() => setCodeLang('curl')}
                  className={`px-3 py-1 rounded-md transition ${codeLang === 'curl' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
                >
                  cURL
                </button>
                <button
                  onClick={() => setCodeLang('node')}
                  className={`px-3 py-1 rounded-md transition ${codeLang === 'node' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
                >
                  Node.js / TypeScript
                </button>
                <button
                  onClick={() => setCodeLang('langchain')}
                  className={`px-3 py-1 rounded-md transition ${codeLang === 'langchain' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400'}`}
                >
                  LangChain Tool Wrapper
                </button>
              </div>

              {/* Code Snippet */}
              <div className="relative rounded-xl bg-black border border-zinc-800 p-4 font-mono text-xs overflow-x-auto text-zinc-300">
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
                  className="absolute right-3 top-3 p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white text-xs flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedText ? 'Copied' : 'Copy Code'}</span>
                </button>

                <pre className="m-0 leading-relaxed text-blue-300">
                  {codeLang === 'python' && `import requests

# External Agent submits tool request to AgentShield
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
        "agent_id": "my_autonomous_agent"
    }
)

result = response.json()
if result["decision"] == "ALLOW":
    print("Payment Authorized on Razorpay:", result["provider_result"]["order"]["id"])
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

                  {codeLang === 'node' && `const response = await fetch("http://localhost:8000/api/v1/agent/execute", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    session_id: "shopper_01",
    tool_name: "create_order",
    arguments: {
      amount: 2999,
      currency: "INR",
      category: "footwear",
      purpose: "running shoes"
    }
  })
});

const result = await response.json();
console.log("Decision:", result.decision);`}

                  {codeLang === 'langchain' && `from langchain.tools import tool
import requests

@tool
def create_order(amount: int, category: str, purpose: str):
    """Create order securely through AgentShield financial firewall."""
    res = requests.post(
        "http://localhost:8000/api/v1/agent/execute",
        json={
            "session_id": "agent_session",
            "tool_name": "create_order",
            "arguments": {
                "amount": amount,
                "category": category,
                "purpose": purpose
            }
        }
    )
    return res.json()`}
                </pre>
              </div>
            </div>
          </section>
        )}

        {/* Tab 4: Security Attack Scenarios */}
        {activeTab === 'scenarios' && (
          <section className="space-y-6">
            <div>
              <h3 className="text-base font-bold text-white">Adversarial Attack & Stress Lab</h3>
              <p className="text-xs text-zinc-400">
                Demonstrates how AgentShield halts attacks that pass ordinary spending limits.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
              {/* Scenario 1 */}
              <div className="glass-panel p-5 flex flex-col justify-between space-y-4 border border-rose-500/30">
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

              {/* Scenario 2 */}
              <div className="glass-panel p-5 flex flex-col justify-between space-y-4 border border-amber-500/30">
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

              {/* Scenario 3 */}
              <div className="glass-panel p-5 flex flex-col justify-between space-y-4 border border-rose-500/30">
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

              {/* Scenario 4 */}
              <div className="glass-panel p-5 flex flex-col justify-between space-y-4 border border-purple-500/30">
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

        {/* Tab 5: Audit Ledger */}
        {activeTab === 'audit' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Security Audit Log</h3>
                <p className="text-xs text-zinc-400">Tamper-evident record of all agent execution requests and policy decisions.</p>
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

            <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-black">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#090d1a] text-zinc-400 border-b border-zinc-800 text-[11px]">
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
                    auditEvents.map((event: AuditEvent) => (
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
                        <td className="py-3.5 px-4 text-zinc-200">{event.tool_name}</td>
                        <td className="py-3.5 px-4 text-zinc-400 font-sans text-xs">
                          {event.reasons.length > 0 ? (
                            <span className="text-rose-400 font-medium">{event.reasons.join(', ')}</span>
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

      {/* Audit Detail Modal Drawer */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="glass-panel rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl border border-white/[0.15]">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-black">
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
              <div className="grid grid-cols-2 gap-3 bg-black p-4 rounded-xl border border-zinc-800">
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
                <pre className="bg-black p-4 rounded-xl border border-zinc-800/80 text-blue-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern Footer */}
      <footer className="border-t border-white/[0.06] bg-black px-6 py-6 text-center text-xs font-mono text-zinc-500 mt-auto">
        AgentShield · The agent may request an action. The agent never authorizes its own action.
      </footer>
    </div>
  );
}
