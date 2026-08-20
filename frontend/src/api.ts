import type { AuditEvent, SessionData, Transaction } from './types';

const API_BASE = '/api/v1';

export async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch('/health');
  return res.json();
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
      },
      intent: intent || {
        category: 'footwear',
        purpose: 'running shoes',
        max_amount: 5000,
        currency: 'INR',
      },
    }),
  });
  if (res.status === 409) {
    return fetchSession(sessionId);
  }
  if (!res.ok) {
    throw new Error(`Failed to create session (${res.status})`);
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
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/reset-spend`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reset session spend');
  return res.json();
}

export async function reconcileSession(sessionId: string): Promise<SessionData> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/reconcile`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reconcile session');
  return res.json();
}
