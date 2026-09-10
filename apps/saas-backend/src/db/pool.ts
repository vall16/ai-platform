// Postgres connection pool.

import { Pool } from 'pg';
import type { Config } from '../config.js';

let pool: Pool | null = null;

export function getPool(config: Config): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
