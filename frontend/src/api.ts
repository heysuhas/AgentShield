import type { AuditEvent, SessionData, Transaction } from './types';

const API_BASE = '/api/v1';

export async function fetchHealth(): Promise<{
  status: string;
  provider?: string;
  razorpay_configured?: boolean;
  razorpay_key_id?: string;
  model?: string;
  environment?: string;
}> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

export async function fetchPaymentConfig(): Promise<{
  provider: string;
  key_id: string | null;
  currency: string;
  sandbox_mode: boolean;
  description: string;
}> {
  const res = await fetch(`${API_BASE}/payments/config`);
  if (!res.ok) throw new Error('Failed to fetch payment config');
  return res.json();
}

export async function verifyPayment(payload: {
  session_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  transaction_id?: string;
}): Promise<{
  verified: boolean;
  transaction_id: string | null;
  status: string;
  message: string;
  order_id: string;
  payment_id: string;
}> {
  const res = await fetch(`${API_BASE}/payments/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail || 'Payment verification failed');
  }
  return data;
}

export async function fetchSession(sessionId: string): Promise<SessionData> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch session (${res.status})`);
  }
  return res.json();
}

export async function createOrInitSession(
  sessionId: string,
  policy?: any,
  intent?: any
): Promise<SessionData> {
  // Refreshing the dashboard should not repeatedly POST and generate noisy
  // 409 responses. Read the existing session first, then create only on 404.
  const existing = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (existing.ok) return existing.json();
  if (existing.status !== 404) {
    const body = await existing.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to load session (${existing.status})`);
  }

  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      policy: policy || {
        allowed_tools: ['create_order', 'fetch_order'],
        max_transaction_amount: 5000,
        max_session_spend: 10000,
        max_requests_per_window: 4,
        window_seconds: 60,
        require_approval_above: 3000,
      },
      intent: intent || {
        category: 'footwear',
        purpose: 'running shoes',
        max_amount: 5000,
        currency: 'INR',
      },
    }),
  });
  if (res.status === 409) return fetchSession(sessionId);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Failed to create session (${res.status})`);
  }
  return res.json();
}

export async function executeToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, any>
): Promise<any> {
  const res = await fetch(`${API_BASE}/tools/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      tool_name: toolName,
      arguments: args,
    }),
  });
  return res.json();
}

export async function executeExternalAgent(
  sessionId: string,
  toolName: string,
  args: Record<string, any>,
  agentId?: string
): Promise<any> {
  const res = await fetch(`${API_BASE}/agent/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      tool_name: toolName,
      arguments: args,
      agent_id: agentId || 'external_agent_client',
    }),
  });
  return res.json();
}

export async function fetchAuditEvents(
  sessionId?: string,
  decision?: string,
  riskLevel?: string,
  limit = 30
): Promise<{ total: number; items: AuditEvent[] }> {
  const params = new URLSearchParams();
  if (sessionId) params.append('session_id', sessionId);
  if (decision) params.append('decision', decision);
  if (riskLevel) params.append('risk_level', riskLevel);
  params.append('limit', limit.toString());

  const res = await fetch(`${API_BASE}/audit?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch audit events');
  return res.json();
}

export async function fetchTransactions(
  sessionId?: string,
  status?: string,
  limit = 30
): Promise<{ total: number; items: Transaction[] }> {
  const params = new URLSearchParams();
  if (sessionId) params.append('session_id', sessionId);
  if (status) params.append('status', status);
  params.append('limit', limit.toString());

  const res = await fetch(`${API_BASE}/transactions?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export async function resetSessionSpend(sessionId: string): Promise<SessionData> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/reset`, {
    method: 'POST',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Failed to reset session spend (${res.status})`);
  return body;
}

export async function reconcileSession(sessionId: string): Promise<SessionData> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/reconcile`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reconcile session');
  return res.json();
}

export async function fetchApprovals(
  sessionId?: string,
  status?: string,
  limit = 30
): Promise<{ total: number; items: any[] }> {
  const params = new URLSearchParams();
  if (sessionId) params.append('session_id', sessionId);
  if (status) params.append('status', status);
  params.append('limit', limit.toString());

  const res = await fetch(`${API_BASE}/approvals?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch approvals');
  return res.json();
}

export async function approveReview(
  approvalId: string,
  reviewedBy = 'security_operator',
  notes?: string
): Promise<any> {
  const res = await fetch(`${API_BASE}/approvals/${approvalId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewed_by: reviewedBy, review_notes: notes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to approve' }));
    throw new Error(err.detail || 'Failed to approve');
  }
  return res.json();
}

export async function rejectReview(
  approvalId: string,
  reviewedBy = 'security_operator',
  notes?: string
): Promise<any> {
  const res = await fetch(`${API_BASE}/approvals/${approvalId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewed_by: reviewedBy, review_notes: notes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to reject' }));
    throw new Error(err.detail || 'Failed to reject');
  }
  return res.json();
}

export async function runAgent(
  sessionId: string,
  userPrompt: string
): Promise<any> {
  const res = await fetch(`${API_BASE}/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, user_prompt: userPrompt }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.detail || `Agent run failed (${res.status})`);
  }
  return body;
}
