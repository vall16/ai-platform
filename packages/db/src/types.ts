// TypeScript types mirroring the database schema.

export type TenantStatus = 'active' | 'suspended' | 'deleted';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export type ProviderType = 'avatar' | 'voice' | 'stt' | 'llm' | 'tts' | 'commerce' | 'billing';
export type ProviderStatus = 'active' | 'inactive' | 'deprecated';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string | null;
  status: ProviderStatus;
  created_at: string;
}

export type ProviderAccountStatus = 'active' | 'inactive';

export interface ProviderAccount {
  id: string;
  tenant_id: string;
  provider_id: string;
  api_key_encrypted: Uint8Array | null;
  config: Record<string, unknown>;
  status: ProviderAccountStatus;
  created_at: string;
}

export type PricingUnit = 'token' | 'second' | 'request' | 'byte' | 'session';

export interface Pricing {
  id: string;
  provider_id: string;
  resource_type: string;
  unit: PricingUnit;
  cost_micro_usd: number;
  effective_from: string;
  effective_to: string | null;
}

export type ProductType = 'persona' | 'salesperson';
export type SessionStatus = 'active' | 'completed' | 'abandoned' | 'error';

export interface Session {
  id: string;
  tenant_id: string;
  product_type: ProductType;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  total_cost_micro_usd: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface UsageLedgerEntry {
  id: string;
  tenant_id: string;
  session_id: string | null;
  provider_id: string;
  resource_type: string;
  cost_micro_usd: number;
  quantity: number;
  unit: PricingUnit;
  trace_id: string | null;
  created_at: string;
}

export interface RoutingDecision {
  id: string;
  tenant_id: string;
  session_id: string | null;
  request_id: string;
  resource_type: string;
  selected_provider_id: string;
  score: number;
  candidates: RoutingCandidate[];
  reason: string | null;
  created_at: string;
}

export interface RoutingCandidate {
  provider_id: string;
  score: number;
  reason?: string;
}
