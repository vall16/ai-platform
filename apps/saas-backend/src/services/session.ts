// Session service — create, track, close conversation sessions.

import type { Pool } from 'pg';
import type { Session, ProductType, SessionStatus } from '@ai-platform/db';

export class SessionService {
  constructor(private readonly pool: Pool) {}

  async create(tenantId: string, productType: ProductType, metadata?: Record<string, unknown>): Promise<Session> {
    const result = await this.pool.query(
      `INSERT INTO session (tenant_id, product_type, metadata)
       VALUES ($1, $2, $3)
       RETURNING id, tenant_id, product_type, status, started_at, ended_at, total_cost_micro_usd, metadata, created_at`,
      [tenantId, productType, JSON.stringify(metadata ?? {})],
    );
    return result.rows[0] as Session;
  }

  async getById(id: string, tenantId: string): Promise<Session | null> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, product_type, status, started_at, ended_at, total_cost_micro_usd, metadata, created_at
       FROM session WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return result.rows[0] as Session | null;
  }

  async listByTenant(tenantId: string, status?: SessionStatus, limit = 50): Promise<Session[]> {
    if (status) {
      const result = await this.pool.query(
        `SELECT id, tenant_id, product_type, status, started_at, ended_at, total_cost_micro_usd, metadata, created_at
         FROM session WHERE tenant_id = $1 AND status = $2
         ORDER BY started_at DESC LIMIT $3`,
        [tenantId, status, limit],
      );
      return result.rows as Session[];
    }
    const result = await this.pool.query(
      `SELECT id, tenant_id, product_type, status, started_at, ended_at, total_cost_micro_usd, metadata, created_at
       FROM session WHERE tenant_id = $1
       ORDER BY started_at DESC LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows as Session[];
  }

  async close(id: string, tenantId: string, status: SessionStatus = 'completed'): Promise<Session | null> {
    const result = await this.pool.query(
      `UPDATE session SET status = $1, ended_at = now()
       WHERE id = $2 AND tenant_id = $3 AND status = 'active'
       RETURNING id, tenant_id, product_type, status, started_at, ended_at, total_cost_micro_usd, metadata, created_at`,
      [status, id, tenantId],
    );
    return result.rows[0] as Session | null;
  }

  async addCost(sessionId: string, costMicroUsd: number): Promise<void> {
    await this.pool.query(
      `UPDATE session SET total_cost_micro_usd = total_cost_micro_usd + $1 WHERE id = $2`,
      [costMicroUsd, sessionId],
    );
  }

  async countActive(tenantId: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM session WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId],
    );
    return result.rows[0].count as number;
  }
}
