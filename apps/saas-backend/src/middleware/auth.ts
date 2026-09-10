// API key authentication middleware.

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export interface AuthContext {
  tenantId: string;
  apiKeyId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function createAuthMiddleware(pool: Pool) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    }

    const rawKey = header.slice(7);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const result = await pool.query(
      `SELECT ak.id, ak.tenant_id, t.status AS tenant_status
       FROM api_key ak
       JOIN tenant t ON t.id = ak.tenant_id
       WHERE ak.key_hash = $1 AND ak.status = 'active'`,
      [keyHash],
    );

    if (result.rows.length === 0) {
      return reply.status(401).send({ error: 'Invalid API key' });
    }

    const row = result.rows[0];
    if (row.tenant_status !== 'active') {
      return reply.status(403).send({ error: 'Tenant is not active' });
    }

    // Update last_used_at (fire-and-forget).
    void pool.query('UPDATE api_key SET last_used_at = now() WHERE id = $1', [row.id]);

    request.auth = { tenantId: row.tenant_id, apiKeyId: row.id };
  };
}
