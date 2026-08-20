import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  Circle,
  CircleAlert,
  CreditCard,
  LockKeyhole,
  Play,
  RefreshCw,
  Shield,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import {
  approveReview,
  createOrInitSession,
  executeToolCall,
  fetchApprovals,
  fetchAuditEvents,
  fetchHealth,
  rejectReview,
  runAgent,
} from './api';
import type { ApprovalRecord, AuditEvent, SessionData } from './types';

const SESSION_ID = 'demo_shopper_01';

type Result = Record<string, any> | null;

function decisionTone(decision?: string) {
  if (decision === 'ALLOW') return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20';
  if (decision === 'REVIEW') return 'text-amber-300 bg-amber-400/10 border-amber-400/20';
  return 'text-rose-300 bg-rose-400/10 border-rose-400/20';
}

function App() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [prompt, setPrompt] = useState('Buy running shoes under ₹5,000');
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [current, audit, pending] = await Promise.all([
        createOrInitSession(SESSION_ID),
        fetchAuditEvents(SESSION_ID, undefined, undefined, 20),
        fetchApprovals(SESSION_ID, 'PENDING', 10),
      ]);
      setSession(current);
      setEvents(audit.items);
      setApprovals(pending.items);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth().then(() => setOnline(true)).catch(() => setOnline(false));
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runAgentRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await runAgent(SESSION_ID, prompt);
      setResult(response);
      await refresh();
    } catch (error: any) {
      setResult({ error: error.message });
    } finally {
      setBusy(false);
    }
  };

  const runScenario = async (name: string, args: Record<string, any>) => {
    setBusy(true);
    try {
      const response = await executeToolCall(SESSION_ID, 'create_order', args);
      setResult({ scenario: name, execution: response, decision: response.decision });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const review = async (approvalId: string, action: 'approve' | 'reject') => {
    setReviewing(approvalId);
    try {
      const response = action === 'approve'
        ? await approveReview(approvalId, 'security_operator', 'Reviewed in AgentShield console')
        : await rejectReview(approvalId, 'security_operator', 'Rejected in AgentShield console');
      setResult({ execution: response, decision: response.decision });
      await refresh();
    } finally {
      setReviewing(null);
    }
  };

  const spendPercent = useMemo(() => {
    const cap = session?.policy?.max_session_spend;
    return cap ? Math.min(100, (session.total_active_spend / cap) * 100) : 0;
  }, [session]);

  const execution = result?.execution ?? result;
  const proposal = result?.proposed_tool_call;

  return (
    <div className="min-h-screen bg-[#08090b] text-[#f5f5f5] selection:bg-cyan-300 selection:text-black">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#08090b]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-300"><Shield size={18} /></div>
            <div><div className="text-sm font-semibold tracking-tight">AgentShield</div><div className="text-[11px] text-zinc-500">Agent authorization console</div></div>
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span className="hidden sm:inline-flex items-center gap-2"><Circle size={8} className={online ? 'fill-emerald-400 text-emerald-400' : 'fill-rose-400 text-rose-400'} />{online ? 'API connected' : 'API offline'}</span>
            <span className="inline-flex items-center gap-2"><CreditCard size={14} className="text-zinc-400" />sandbox provider</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <section className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div>
            <div className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-300"><Bot size={14} /> trust boundary</div>
            <h1 className="max-w-2xl text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">The agent can ask.<br /><span className="text-zinc-500">It cannot authorize.</span></h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-zinc-400">Run a real natural-language request through NVIDIA NIM, deterministic policy, intent validation, human review, and the payment provider.</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5">
            <div className="mb-4 flex items-center justify-between text-xs text-zinc-500"><span>Pipeline</span><span className="font-mono text-zinc-600">01 / 04</span></div>
            <div className="flex items-center gap-2 text-xs"><span className="rounded-lg bg-cyan-300/10 px-2.5 py-2 text-cyan-200">NIM</span><ArrowRight size={13} className="text-zinc-700" /><span className="rounded-lg bg-white/[0.06] px-2.5 py-2 text-zinc-200">Shield</span><ArrowRight size={13} className="text-zinc-700" /><span className="rounded-lg bg-white/[0.06] px-2.5 py-2 text-zinc-200">Razorpay</span></div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Metric label="Active spend" value={`₹${(session?.total_active_spend ?? 0).toLocaleString()}`} detail={session?.policy?.max_session_spend ? `of ₹${session.policy.max_session_spend.toLocaleString()} cap` : 'no cap'} />
          <Metric label="Reserved" value={`₹${(session?.reserved_spend ?? 0).toLocaleString()}`} detail="held for review / execution" />
          <Metric label="Intent" value={session?.intent?.category ?? 'not configured'} detail={session?.intent?.purpose ?? 'Create a session to begin'} />
        </section>
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-cyan-300 transition-all duration-700" style={{ width: `${spendPercent}%` }} /></div>

        <section className="grid gap-5 lg:grid-cols-[1fr_0.85fr]">
          <div className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-300/[0.08] to-transparent p-6 shadow-2xl shadow-cyan-950/20">
            <div className="mb-5 flex items-start justify-between"><div><div className="text-xs font-medium text-cyan-200">Agent command</div><h2 className="mt-2 text-xl font-semibold tracking-tight">What should the agent buy?</h2></div><Zap size={18} className="text-cyan-300" /></div>
            <form onSubmit={runAgentRequest} className="space-y-3"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full resize-none rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/50 focus:ring-4 focus:ring-cyan-300/10" placeholder="Describe the user's request..." /><button disabled={busy || !prompt.trim()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Evaluating request…' : <><Play size={15} />Run through AgentShield</>}</button></form>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6"><div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-medium">Decision trace</h2><LockKeyhole size={15} className="text-zinc-600" /></div>{!result ? <Empty text="Your model proposal and final authorization will appear here." /> : result.error ? <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{result.error}</div> : <div className="space-y-4 text-sm"><Trace label="Model proposed" value={proposal?.tool_name ?? 'direct tool call'} mono /><pre className="max-h-24 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-zinc-400">{JSON.stringify(proposal?.arguments ?? execution?.provider_result, null, 2)}</pre><Trace label="AgentShield decision" value={execution?.decision ?? result.decision} badge /><Trace label="Risk" value={`${execution?.risk_level ?? '—'} · ${execution?.risk_score ?? '—'}`} /><div className="border-t border-white/[0.07] pt-3 text-xs text-zinc-500">{execution?.reasons?.join(' · ') || 'No violations. Provider was authorized.'}</div></div>}</div>
        </section>

        <section><div className="mb-4 flex items-end justify-between"><div><div className="text-xs font-medium text-zinc-500">Proof, not decoration</div><h2 className="mt-1 text-lg font-semibold">Security scenarios</h2></div><span className="text-xs text-zinc-600">Each request crosses the same boundary</span></div><div className="grid gap-3 md:grid-cols-3"><Scenario title="Valid purchase" description="Footwear, ₹1,500 · should allow" tone="emerald" onClick={() => runScenario('valid purchase', { amount: 1500, currency: 'INR', category: 'footwear', purpose: 'running shoes' })} /><Scenario title="Prompt injection" description="Gift card disguised as footwear · should block" tone="rose" onClick={() => runScenario('prompt injection', { amount: 4999, currency: 'INR', category: 'gift_card', purpose: 'gift' })} /><Scenario title="High-value order" description="₹4,000 · enters human review" tone="amber" onClick={() => runScenario('high-value order', { amount: 4000, currency: 'INR', category: 'footwear', purpose: 'running shoes' })} /></div></section>

        {approvals.length > 0 && <section className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.05] p-6"><div className="mb-5 flex items-center gap-3"><UserCheck size={17} className="text-amber-300" /><div><h2 className="text-sm font-semibold text-amber-100">Human review required</h2><p className="mt-1 text-xs text-amber-200/50">Spend is reserved. No provider call has happened.</p></div></div><div className="space-y-2">{approvals.map((approval) => <div key={approval.approval_id} className="flex flex-col gap-4 rounded-xl border border-white/[0.07] bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-medium">{approval.tool_name} · ₹{approval.amount?.toLocaleString() ?? 0}</div><div className="mt-1 text-xs text-zinc-500">{approval.reasons.join(' · ')}</div></div><div className="flex gap-2"><button disabled={reviewing === approval.approval_id} onClick={() => review(approval.approval_id, 'approve')} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-300 transition hover:bg-emerald-400/20"><Check size={14} />Approve</button><button disabled={reviewing === approval.approval_id} onClick={() => review(approval.approval_id, 'reject')} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-400/10 px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-400/20"><X size={14} />Reject</button></div></div>)}</div></section>}

        <section className="grid gap-5 lg:grid-cols-[1fr_0.8fr]"><div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6"><div className="mb-5 flex items-center justify-between"><div><div className="text-xs text-zinc-500">Immutable trail</div><h2 className="mt-1 text-sm font-semibold">Recent activity</h2></div><button onClick={() => void refresh()} className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/[0.06] hover:text-white"><RefreshCw size={15} /></button></div>{events.length === 0 ? <Empty text="No security events yet." /> : <div className="space-y-1">{events.slice(0, 8).map((event) => <div key={event.event_id} className="flex items-center justify-between gap-4 rounded-xl px-3 py-3 transition hover:bg-white/[0.04]"><div className="flex min-w-0 items-center gap-3"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${decisionTone(event.decision)}`}>{event.decision === 'ALLOW' ? <Check size={13} /> : event.decision === 'REVIEW' ? <CircleAlert size={13} /> : <X size={13} />}</span><div className="min-w-0"><div className="truncate text-xs font-medium">{event.tool_name}</div><div className="truncate text-[11px] text-zinc-600">{event.reasons.join(' · ') || event.transaction_status || 'evaluated'}</div></div></div><span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold ${decisionTone(event.decision)}`}>{event.decision}</span></div>)}</div>}</div><div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6"><div className="mb-5 flex items-center gap-2"><Activity size={15} className="text-cyan-300" /><h2 className="text-sm font-semibold">Boundary status</h2></div><div className="space-y-4"><Status label="Policy" value={session?.policy ? 'enforcing' : 'not configured'} /><Status label="Intent" value={session?.intent ? 'authorized' : 'not configured'} /><Status label="Spend lock" value={`${session?.reserved_spend ?? 0} reserved`} /><Status label="Audit" value={`${events.length} recent events`} /></div></div></section>
      </main>
      <footer className="border-t border-white/[0.07] px-6 py-5 text-center text-[11px] text-zinc-600">AgentShield · The agent may request an action. The agent never authorizes its own action.</footer>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="text-xs text-zinc-500">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div><div className="mt-1 truncate text-xs text-zinc-600">{detail}</div></div>; }
function Trace({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: boolean }) { return <div className="flex items-center justify-between gap-4"><span className="text-xs text-zinc-500">{label}</span><span className={badge ? `rounded-md border px-2 py-1 text-xs font-semibold ${decisionTone(value)}` : mono ? 'font-mono text-xs text-cyan-300' : 'text-xs text-zinc-300'}>{value}</span></div>; }
function Status({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 text-xs"><span className="text-zinc-500">{label}</span><span className="text-zinc-300">{value}</span></div>; }
function Empty({ text }: { text: string }) { return <div className="flex min-h-24 items-center justify-center text-center text-xs leading-5 text-zinc-600">{text}</div>; }
function Scenario({ title, description, tone, onClick }: { title: string; description: string; tone: 'emerald' | 'rose' | 'amber'; onClick: () => void }) { const colors = { emerald: 'border-emerald-400/20 hover:border-emerald-400/50', rose: 'border-rose-400/20 hover:border-rose-400/50', amber: 'border-amber-400/20 hover:border-amber-400/50' }; return <button onClick={onClick} className={`group rounded-2xl border bg-white/[0.025] p-5 text-left transition duration-300 hover:-translate-y-0.5 hover:bg-white/[0.05] ${colors[tone]}`}><div className="mb-6 flex items-center justify-between"><span className="text-sm font-medium">{title}</span><ArrowRight size={15} className="text-zinc-600 transition group-hover:translate-x-1 group-hover:text-white" /></div><p className="m-0 text-xs leading-5 text-zinc-500">{description}</p></button>; }

export default App;
