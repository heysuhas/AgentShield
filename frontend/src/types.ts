export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Decision = 'ALLOW' | 'BLOCK' | 'REVIEW';

export interface PolicyViolation {
  rule: string;
  actual: string | number;
  limit?: string | number | null;
}

export interface IntentValidationResult {
  intent_match: boolean;
  category_match?: boolean;
  purpose_match?: boolean;
  amount_within_limit?: boolean;
  currency_match?: boolean;
  recipient_match?: boolean;
  merchant_match?: boolean;
  confidence?: number;
  reason?: string | null;
}

export interface PaymentResult {
  success: boolean;
  order?: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    receipt?: string | null;
  } | null;
  error?: string | null;
  raw_response?: Record<string, any> | null;
}

export interface AuditEvent {
  event_id: string;
  transaction_id?: string | null;
  transaction_status?: string | null;
  session_id: string;
  tool_name: string;
  arguments: Record<string, any>;
  decision: Decision;
  risk_score: number;
  risk_level: RiskLevel;
  reasons: string[];
  policy_violations: PolicyViolation[];
  semantic_validation?: IntentValidationResult | null;
  provider_name?: string | null;
  provider_result?: PaymentResult | null;
  timestamp: string;
}

export interface Transaction {
  transaction_id: string;
  session_id: string;
  tool_name: string;
  amount?: number | null;
  currency: string;
  status: string;
  decision: string;
  reasons: string[];
  arguments: Record<string, any>;
  provider_order_id?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRecord {
  approval_id: string;
  transaction_id: string;
  session_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  tool_name: string;
  amount?: number | null;
  currency: string;
  arguments: Record<string, any>;
  risk_score: number;
  risk_level: string;
  reasons: string[];
  reviewed_by?: string | null;
  review_notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionData {
  session_id: string;
  status: string;
  policy?: {
    allowed_tools: string[];
    max_transaction_amount?: number | null;
    max_session_spend?: number | null;
    max_requests_per_window?: number | null;
    window_seconds: number;
    max_spend_per_window?: number | null;
    require_approval_above?: number | null;
    require_human_approval?: boolean;
  } | null;
  intent?: {
    category?: string | null;
    purpose?: string | null;
    recipient?: string | null;
    merchant?: string | null;
    max_amount?: number | null;
    currency: string;
    allowed_tools?: string[] | null;
    constraints: Record<string, any>;
  } | null;
  committed_spend: number;
  reserved_spend: number;
  total_active_spend: number;
}
