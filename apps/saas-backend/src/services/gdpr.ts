// GdprService — GDPR data-subject rights for a tenant (the merchant).
//
// A tenant owns all the personal data the platform stores on its behalf:
// conversation sessions (with metadata), the cost-ledger usage entries and the
// routing decisions. This service implements the three core rights:
//   * right of access / portability  -> exportTenantData / exportCustomerData
//   * right to erasure               -> deleteTenantData / deleteCustomerData
//   * storage limitation (retention) -> purgeExpired
//
// It also resolves a Shopify shop domain to its tenant so the privacy webhooks
// (customers/redact, customers/data_request, shop/redact) can be routed to the
// correct data owner.

import type { Pool } from 'pg';
import type { Session, UsageLedgerEntry, RoutingDecision } from '@ai-platform/db';

/** A data subject (end-user) identified within a tenant's sessions. */
export interface GdprCustomer {
  email?: string;
  customerId?: string;
}

export interface GdprProviderAccount {
  provider_id: string;
  config: Record<string, unknown>;
  status: string;
}

/** The complete, portable data bundle for a tenant (right of access). */
export interface GdprExportBundle {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    created_at: string;
  } | null;
  sessions: Session[];
  usage_ledger: UsageLedgerEntry[];
  routing_decisions: RoutingDecision[];
  provider_accounts: GdprProviderAccount[];
  exported_at: string;
}

export interface GdprDeletionResult {
  tenant_id: string;
  deleted: {
    sessions: number;
    usage_ledger: number;
    routing_decisions: number;
    provider_accounts: number;
    api_keys: number;
  };
  deleted_at: string;
}

export interface GdprPurgeResult {
  before: string;
  deleted: {
    sessions: number;
    usage_ledger: number;
    routing_decisions: number;
  };
}

export class GdprService {
  constructor(private readonly pool: Pool) {}

  /** Right of access / portability: every row the platform holds for a tenant. */
  async exportTenantData(tenantId: string): Promise<GdprExportBundle> {
    const tenant = await this.pool.query(
      `SELECT id, name, slug, status, created_at FROM tenant WHERE id = $1`,
      [tenantId],
    );
    const sessions = await this.pool.query(
      `SELECT id, tenant_id, product_type, status, started_at, ended_at,
              total_cost_micro_usd, revenue_micro_usd, cart_additions,
              orders_influenced, revenue_influenced, metadata, created_at
       FROM session WHERE tenant_id = $1 ORDER BY started_at DESC`,
      [tenantId],
    );
    const usage = await this.pool.query(
      `SELECT id, tenant_id, session_id, provider_id, resource_type, cost_micro_usd,
              quantity, unit, trace_id, created_at
       FROM usage_ledger WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    const routing = await this.pool.query(
      `SELECT id, tenant_id, session_id, request_id, resource_type, selected_provider_id,
              score, candidates, reason, created_at
       FROM routing_decision WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    const accounts = await this.pool.query(
      `SELECT provider_id, config, status FROM provider_account WHERE tenant_id = $1`,
      [tenantId],
    );

    return {
      tenant: tenant.rows[0] ?? null,
      sessions: sessions.rows as Session[],
      usage_ledger: usage.rows as UsageLedgerEntry[],
      routing_decisions: routing.rows as RoutingDecision[],
      provider_accounts: accounts.rows as GdprProviderAccount[],
      exported_at: new Date().toISOString(),
    };
  }

  /**
   * Right to erasure: remove every row the platform holds for a tenant and
   * mark the tenant as deleted (soft delete — the marker proves the deletion).
   * Order matters: children (usage_ledger, routing_decision) before parents
   * (session, provider_account, api_key), then the tenant row.
   */
  async deleteTenantData(tenantId: string): Promise<GdprDeletionResult> {
    const usage = await this.pool.query(`DELETE FROM usage_ledger WHERE tenant_id = $1`, [tenantId]);
    const routing = await this.pool.query(`DELETE FROM routing_decision WHERE tenant_id = $1`, [tenantId]);
    const sessions = await this.pool.query(`DELETE FROM session WHERE tenant_id = $1`, [tenantId]);
    const accounts = await this.pool.query(`DELETE FROM provider_account WHERE tenant_id = $1`, [tenantId]);
    const keys = await this.pool.query(`DELETE FROM api_key WHERE tenant_id = $1`, [tenantId]);
    const deletedAt = new Date().toISOString();
    await this.pool.query(
      `UPDATE tenant SET status = 'deleted', deleted_at = $1, updated_at = now() WHERE id = $2`,
      [deletedAt, tenantId],
    );

    return {
      tenant_id: tenantId,
      deleted: {
        sessions: sessions.rowCount ?? 0,
        usage_ledger: usage.rowCount ?? 0,
        routing_decisions: routing.rowCount ?? 0,
        provider_accounts: accounts.rowCount ?? 0,
        api_keys: keys.rowCount ?? 0,
      },
      deleted_at: deletedAt,
    };
  }

  /** Right of access for a single data subject within a tenant. */
  async exportCustomerData(tenantId: string, customer: GdprCustomer): Promise<GdprExportBundle> {
    const sessions = await this.pool.query(
      `SELECT id, tenant_id, product_type, status, started_at, ended_at,
              total_cost_micro_usd, revenue_micro_usd, cart_additions,
              orders_influenced, revenue_influenced, metadata, created_at
       FROM session WHERE tenant_id = $1 AND ${this.customerPredicate(customer)}`,
      [tenantId, this.customerValue(customer)],
    );
    const sessionIds = (sessions.rows as Session[]).map((s) => s.id);
    const usage = await this.pool.query(
      `SELECT id, tenant_id, session_id, provider_id, resource_type, cost_micro_usd,
              quantity, unit, trace_id, created_at
       FROM usage_ledger WHERE tenant_id = $1 AND session_id IN (${this.idList(sessionIds)})`,
      [tenantId, ...sessionIds],
    );

    return {
      tenant: null,
      sessions: sessions.rows as Session[],
      usage_ledger: usage.rows as UsageLedgerEntry[],
      routing_decisions: [],
      provider_accounts: [],
      exported_at: new Date().toISOString(),
    };
  }

  /** Right to erasure for a single data subject within a tenant. */
  async deleteCustomerData(tenantId: string, customer: GdprCustomer): Promise<{ deleted: { sessions: number; usage_ledger: number } }> {
    const usage = await this.pool.query(
      `DELETE FROM usage_ledger WHERE tenant_id = $1 AND session_id IN (
         SELECT id FROM session WHERE tenant_id = $1 AND ${this.customerPredicate(customer)})`,
      [tenantId, this.customerValue(customer)],
    );
    const sessions = await this.pool.query(
      `DELETE FROM session WHERE tenant_id = $1 AND ${this.customerPredicate(customer)}`,
      [tenantId, this.customerValue(customer)],
    );
    return {
      deleted: {
        sessions: sessions.rowCount ?? 0,
        usage_ledger: usage.rowCount ?? 0,
      },
    };
  }

  /**
   * Storage limitation: purge data older than the cutoff. Called by a
   * scheduled job (cron) on a retention schedule.
   */
  async purgeExpired(beforeIso: string): Promise<GdprPurgeResult> {
    const usage = await this.pool.query(`DELETE FROM usage_ledger WHERE created_at < $1`, [beforeIso]);
    const routing = await this.pool.query(`DELETE FROM routing_decision WHERE created_at < $1`, [beforeIso]);
    const sessions = await this.pool.query(`DELETE FROM session WHERE started_at < $1`, [beforeIso]);
    return {
      before: beforeIso,
      deleted: {
        sessions: sessions.rowCount ?? 0,
        usage_ledger: usage.rowCount ?? 0,
        routing_decisions: routing.rowCount ?? 0,
      },
    };
  }

  /** Resolve a Shopify shop domain to its (non-deleted) tenant id. */
  async findTenantByShop(shopDomain: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT id FROM tenant WHERE shop_domain = $1 AND status <> 'deleted'`,
      [shopDomain],
    );
    return result.rows[0]?.id ?? null;
  }

  // --- helpers -----------------------------------------------------------

  private customerPredicate(customer: GdprCustomer): string {
    // Match on email first (the identifier Shopify privacy webhooks carry);
    // fall back to the numeric customer id when no email is present.
    return customer.email
      ? `metadata->>'email' = $2`
      : `metadata->>'customer_id' = $2`;
  }

  private customerValue(customer: GdprCustomer): string {
    return customer.email ?? customer.customerId ?? '';
  }

  /** Build a safe `IN (...)` placeholder list for a set of session ids. */
  private idList(ids: string[]): string {
    if (ids.length === 0) return `NULL`;
    return ids.map((_, i) => `$${i + 2}`).join(', ');
  }
}
