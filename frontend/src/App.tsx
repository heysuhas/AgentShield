import React, { useEffect, useState } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Activity,
  RotateCcw,
  RefreshCw,
  Play,
  FileText,
  CreditCard,
  Target,
  Clock,
  Layers,
  ChevronRight,
  Code,
  X,
  Loader2
} from 'lucide-react';
import {
  createOrInitSession,
  executeToolCall,
  fetchAuditEvents,
  fetchHealth,
  fetchTransactions,
  reconcileSession,
  resetSessionSpend
} from './api';
import type { AuditEvent, SessionData, Transaction } from './types';

const DEFAULT_SESSION_ID = 'demo_shopper_01';

export default function App() {
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION_ID);
  const [session, setSession] = useState<SessionData | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isBackendHealthy, setIsBackendHealthy] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [executingDemo, setExecutingDemo] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  // Custom tool execution form state
  const [customTool, setCustomTool] = useState('create_order');
  const [customAmount, setCustomAmount] = useState('3500');
  const [customCategory, setCustomCategory] = useState('footwear');
  const [customPurpose, setCustomPurpose] = useState('running shoes');
  const [customRecipient, setCustomRecipient] = useState('');

  // Load session and audit log
  const refreshData = React.useCallback(async () => {
    try {
      const sess = await createOrInitSession(sessionId);
      setSession(sess);
      const audit = await fetchAuditEvents(sessionId, undefined, undefined, 50);
      setAuditEvents(audit.items);
      const txns = await fetchTransactions(sessionId, undefined, 50);
      setTransactions(txns.items);
    } catch (e) {
      console.error(e);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchHealth()
      .then(() => setIsBackendHealthy(true))
      .catch(() => setIsBackendHealthy(false));

    void refreshData();
    const interval = setInterval(() => {
      void refreshData();
    }, 4000);
    return () => clearInterval(interval);
  }, [refreshData]);

  const handleDemoRun = async (
    name: string,
    toolName: string,
    args: Record<string, any>
  ) => {
    setExecutingDemo(name);
    setLoading(true);
    try {
      const res = await executeToolCall(sessionId, toolName, args);
      setLastResult(res);
      await refreshData();
    } catch (err: any) {
      setLastResult({ error: err.message });
    } finally {
      setLoading(false);
      setExecutingDemo(null);
    }
  };

  const handleVelocityBurst = async () => {
    setExecutingDemo('velocity_burst');
    setLoading(true);
    try {
      // Fire 5 rapid requests to trigger velocity limit (max 4 per 60s)
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
      setExecutingDemo(null);
    }
  };

  const handleResetSpend = async () => {
    if (!session) return;
    const updated = await resetSessionSpend(session.session_id);
    setSession(updated);
    refreshData();
  };

  const handleReconcile = async () => {
    if (!session) return;
    const updated = await reconcileSession(session.session_id);
    setSession(updated);
    refreshData();
  };

  const handleCustomExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const args: Record<string, any> = {};
    if (customAmount) args.amount = parseInt(customAmount, 10);
    if (customCategory) args.category = customCategory;
    if (customPurpose) args.purpose = customPurpose;
    if (customRecipient) args.recipient = customRecipient;

    try {
      const res = await executeToolCall(sessionId, customTool, args);
      setLastResult(res);
      await refreshData();
    } finally {
      setLoading(false);
    }
  };

  const spendPercent = session?.policy?.max_session_spend
    ? Math.min(100, Math.round((session.total_active_spend / session.policy.max_session_spend) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-[#0d1322] px-6 py-4 sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white m-0">AgentShield</h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/60 border border-blue-700 text-blue-300 font-mono">
                  Trust Layer
                </span>
              </div>
              <p className="text-xs text-slate-400 m-0">
                Authorization & Risk Boundary between Autonomous Agents and Payment Infrastructure
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span className="text-slate-400">Session:</span>
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="bg-transparent font-mono text-blue-300 w-32 border-none focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  isBackendHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'
                }`}
              />
              <span className="text-slate-300 font-medium">
                {isBackendHealthy ? 'Online' : 'Offline'}
              </span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <CreditCard className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400">Provider:</span>
              <span className="text-indigo-300 font-mono font-medium">Mock / Sandbox</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-6 py-8 flex-1 w-full space-y-8">
        {/* Session & Budget Overview */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Active Budget & Spend */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950 border border-slate-800/80 shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-300 font-semibold text-sm">
                <Activity className="w-4 h-4 text-blue-400" />
                Session Spending
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleResetSpend}
                  title="Reset Spend"
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition text-xs flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
                <button
                  onClick={handleReconcile}
                  title="Reconcile Stranded Reservations"
                  className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition text-xs flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reconcile
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-extrabold text-white">
                  ₹{session?.total_active_spend.toLocaleString() ?? '0'}
                </span>
                <span className="text-sm text-slate-400">
                  / ₹{session?.policy?.max_session_spend?.toLocaleString() ?? '∞'} limit
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
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

              <div className="flex justify-between text-xs text-slate-400 pt-1">
                <span>Committed: ₹{session?.committed_spend.toLocaleString() ?? 0}</span>
                <span>Reserved: ₹{session?.reserved_spend.toLocaleString() ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Card 2: Authorized Intent */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950 border border-slate-800/80 shadow-md">
            <div className="flex items-center gap-2 text-slate-300 font-semibold text-sm mb-4">
              <Target className="w-4 h-4 text-emerald-400" />
              User Authorized Intent
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Category:</span>
                <span className="font-mono text-emerald-300 font-semibold">
                  {session?.intent?.category ?? 'Any'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Purpose:</span>
                <span className="font-mono text-slate-200">
                  {session?.intent?.purpose ?? 'Not specified'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Max Transaction:</span>
                <span className="font-mono text-slate-200">
                  ₹{session?.intent?.max_amount?.toLocaleString() ?? 'No limit'}
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Security Policy & Velocity */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950 border border-slate-800/80 shadow-md">
            <div className="flex items-center gap-2 text-slate-300 font-semibold text-sm mb-4">
              <Clock className="w-4 h-4 text-purple-400" />
              Hard Policy & Velocity
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Allowed Tools:</span>
                <span className="font-mono text-purple-300 font-medium">
                  {session?.policy?.allowed_tools.join(', ') ?? 'None'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Txn Amount Cap:</span>
                <span className="font-mono text-slate-200">
                  ₹{session?.policy?.max_transaction_amount?.toLocaleString() ?? 'No limit'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Burst Velocity Limit:</span>
                <span className="font-mono text-purple-300">
                  {session?.policy?.max_requests_per_window ?? 4} req / {session?.policy?.window_seconds ?? 60}s
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Live Attack & Scenarios Tester */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 m-0">
              <Zap className="w-5 h-5 text-amber-400" />
              Interactive Security Demonstrations
            </h2>
            <span className="text-xs text-slate-400">
              Trigger agent tool requests through the AgentShield trust boundary
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Scenario 1: Allowed Action */}
            <button
              onClick={() =>
                handleDemoRun('valid_order', 'create_order', {
                  amount: 3500,
                  category: 'footwear',
                  purpose: 'running shoes',
                })
              }
              disabled={loading}
              className="p-4 rounded-xl text-left bg-slate-900/80 hover:bg-slate-850 border border-emerald-500/30 hover:border-emerald-500/60 transition group shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                    ALLOW
                  </span>
                  {executingDemo === 'valid_order' ? (
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition" />
                  )}
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">1. Valid Purchase</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Buy running shoes for ₹3,500. Matches intent, policy, and session limits.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-mono text-emerald-400/80">
                Risk: LOW (0.00)
              </div>
            </button>

            {/* Scenario 2: Semantic Prompt Injection */}
            <button
              onClick={() =>
                handleDemoRun('prompt_injection', 'create_order', {
                  amount: 4999,
                  category: 'gift_card',
                  purpose: 'digital gift card voucher',
                })
              }
              disabled={loading}
              className="p-4 rounded-xl text-left bg-slate-900/80 hover:bg-slate-850 border border-rose-500/30 hover:border-rose-500/60 transition group shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800">
                    BLOCK
                  </span>
                  {executingDemo === 'prompt_injection' ? (
                    <Loader2 className="w-4 h-4 text-rose-400 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 text-rose-400 group-hover:translate-x-0.5 transition" />
                  )}
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">2. Prompt Injection</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Agent purchases a ₹4,999 gift card instead of authorized running shoes.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-mono text-rose-400/80">
                Risk: CRITICAL (Category Mismatch)
              </div>
            </button>

            {/* Scenario 3: Aggregate Limit Breach */}
            <button
              onClick={() =>
                handleDemoRun('aggregate_spend', 'create_order', {
                  amount: 4500,
                  category: 'footwear',
                  purpose: 'running shoes',
                })
              }
              disabled={loading}
              className="p-4 rounded-xl text-left bg-slate-900/80 hover:bg-slate-850 border border-amber-500/30 hover:border-amber-500/60 transition group shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800">
                    AGGREGATE CAP
                  </span>
                  {executingDemo === 'aggregate_spend' ? (
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 text-amber-400 group-hover:translate-x-0.5 transition" />
                  )}
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">3. Cumulative Budget</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Attempt ₹4,500 order. Multiple allowed purchases breach ₹10k session cap.
                </p>
              </div>
              <div className="mt-3 text-[11px] font-mono text-amber-400/80">
                Risk: CRITICAL (Max Session Spend)
              </div>
            </button>

            {/* Scenario 4: Velocity Burst */}
            <button
              onClick={handleVelocityBurst}
              disabled={loading}
              className="p-4 rounded-xl text-left bg-slate-900/80 hover:bg-slate-850 border border-purple-500/30 hover:border-purple-500/60 transition group shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-800">
                    VELOCITY
                  </span>
                  {executingDemo === 'velocity_burst' ? (
                    <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 text-purple-400 group-hover:translate-x-0.5 transition" />
                  )}
                </div>
                <h3 className="text-sm font-semibold text-white mb-1">4. Burst Anomaly</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Fire 5 rapid consecutive orders. Exceeds frequency limit (4 req/60s).
                </p>
              </div>
              <div className="mt-3 text-[11px] font-mono text-purple-400/80">
                Risk: CRITICAL (Velocity Exceeded)
              </div>
            </button>
          </div>

          {/* Last Execution Live Response Banner */}
          {lastResult && (
            <div className={`p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition ${
              lastResult.decision === 'ALLOW'
                ? 'bg-emerald-950/40 border-emerald-600/40 text-emerald-200'
                : 'bg-rose-950/40 border-rose-600/40 text-rose-200'
            }`}>
              <div className="flex items-center gap-3">
                {lastResult.decision === 'ALLOW' ? (
                  <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
                ) : (
                  <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base">
                      DECISION: {lastResult.decision}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono">
                      Risk Level: {lastResult.risk_level || (lastResult.risk_score > 0.5 ? 'CRITICAL' : 'LOW')} ({lastResult.risk_score ?? 0})
                    </span>
                    {lastResult.transaction_id && (
                      <span className="text-xs text-slate-400 font-mono">
                        {lastResult.transaction_id}
                      </span>
                    )}
                  </div>
                  {lastResult.reasons?.length > 0 && (
                    <p className="text-xs text-slate-300 mt-0.5">
                      Reasons: {lastResult.reasons.join(', ')}
                    </p>
                  )}
                  {lastResult.policy_violations?.length > 0 && (
                    <p className="text-xs text-rose-300 mt-0.5">
                      Violations: {lastResult.policy_violations.map((v: any) => `${v.rule} (actual: ${v.actual}, limit: ${v.limit})`).join(' | ')}
                    </p>
                  )}
                </div>
              </div>

              {lastResult.provider_result?.order && (
                <div className="text-xs font-mono bg-slate-900/80 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300">
                  Provider Order: {lastResult.provider_result.order.id} (Status: {lastResult.provider_result.order.status})
                </div>
              )}
            </div>
          )}
        </section>

        {/* Live Audit Stream & Custom Sandbox */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 m-0">
              <Layers className="w-5 h-5 text-blue-400" />
              Live Security Audit Trail
            </h2>
            <span className="text-xs text-slate-400">
              Showing newest security decision logs ({auditEvents.length} events, {transactions.length} transactions)
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-slate-400 uppercase font-mono text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Decision</th>
                  <th className="py-3 px-4">Risk Level</th>
                  <th className="py-3 px-4">Tool & Args</th>
                  <th className="py-3 px-4">Violation / Reasons</th>
                  <th className="py-3 px-4">Transaction / Provider</th>
                  <th className="py-3 px-4 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {auditEvents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No security audit events recorded yet. Run a demonstration above!
                    </td>
                  </tr>
                ) : (
                  auditEvents.map((event) => (
                    <tr
                      key={event.event_id}
                      className="hover:bg-slate-900/40 transition cursor-pointer"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            event.decision === 'ALLOW'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
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
                      <td className="py-3 px-4 font-sans text-xs">
                        <span className="font-mono text-blue-300 font-semibold">{event.tool_name}</span>
                        <span className="text-slate-400 ml-1">
                          ({JSON.stringify(event.arguments).slice(0, 32)}...)
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs font-sans">
                        {event.reasons.length > 0 ? (
                          <span className="text-rose-300 font-medium">
                            {event.reasons.join(', ')}
                          </span>
                        ) : (
                          <span className="text-emerald-400 text-[11px]">Clean / Policy Compliant</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap text-[11px]">
                        {event.transaction_id ?? '-'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(event);
                          }}
                          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
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

        {/* Custom Execution Form Sandbox */}
        <section className="p-6 rounded-2xl bg-slate-950/70 border border-slate-800/80 shadow-md">
          <div className="flex items-center gap-2 mb-4">
            <Code className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold text-white m-0">Custom Tool Call Sandbox</h3>
          </div>

          <form onSubmit={handleCustomExecute} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Tool Name</label>
              <select
                value={customTool}
                onChange={(e) => setCustomTool(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="create_order">create_order</option>
                <option value="fetch_order">fetch_order</option>
                <option value="create_payout">create_payout (Disallowed)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Amount (INR)</label>
              <input
                type="number"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono"
                placeholder="3500"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Category</label>
              <input
                type="text"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                placeholder="footwear"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Purpose / Recipient</label>
              <input
                type="text"
                value={customPurpose || customRecipient}
                onChange={(e) => {
                  setCustomPurpose(e.target.value);
                  setCustomRecipient(e.target.value);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                placeholder="running shoes"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-lg text-xs transition flex items-center justify-center gap-2"
              >
                <Play className="w-3.5 h-3.5" />
                Execute Tool
              </button>
            </div>
          </form>
        </section>
      </main>

      {/* Audit Detail Modal Drawer */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white text-sm m-0">
                  Audit Event: {selectedEvent.event_id}
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
              <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div>
                  <span className="text-slate-500">Decision:</span>{' '}
                  <span className={selectedEvent.decision === 'ALLOW' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
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
                <h4 className="text-slate-400 uppercase text-[10px] tracking-wider mb-1 font-bold">Raw Audit Event Payload</h4>
                <pre className="bg-[#090d16] p-4 rounded-xl border border-slate-800/80 text-emerald-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selectedEvent, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
