// API key service — generation and validation.

import { randomBytes, createHash } from 'node:crypto';
import type { Pool } from 'pg';

export interface ApiKeyRecord {
  id: string;
  tenant_id: string;
  prefix: string;
  label: string | null;
  status: string;
  last_used_at: string | null;
  created_at: string;
}

export class ApiKeyService {
  constructor(
    private readonly pool: Pool,
    private readonly keyPrefix: string,
  ) {}

  /** Generate a new API key for a tenant. Returns the plaintext key (shown once). */
  async generate(tenantId: string, label?: string): Promise<{ plaintext: string; record: ApiKeyRecord }> {
    const secret = randomBytes(32).toString('hex');
    const plaintext = `${this.keyPrefix}${secret}`;
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    const prefix = plaintext.slice(0, 12);

    const result = await this.pool.query(
      `INSERT INTO api_key (tenant_id, key_hash, prefix, label)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tenant_id, prefix, label, status, last_used_at, created_at`,
      [tenantId, keyHash, prefix, label ?? null],
    );

    return { plaintext, record: result.rows[0] as ApiKeyRecord };
  }

  async listByTenant(tenantId: string): Promise<ApiKeyRecord[]> {
    const result = await this.pool.query(
      `SELECT id, tenant_id, prefix, label, status, last_used_at, created_at
       FROM api_key WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId],
    );
    return result.rows as ApiKeyRecord[];
  }

  async revoke(id: string, tenantId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE api_key SET status = 'revoked' WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [id, tenantId],
    );
    return result.rowCount > 0;
  }
}
