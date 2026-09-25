// @ai-platform/db — migration runner.
//
// Applies the SQL migrations in packages/db/src/migrations in filename order,
// tracking what has been applied in a `schema_migrations` table so it is
// idempotent (safe to re-run). Used locally (`npm run migrate`) and as the
// Kubernetes init Job that prepares Postgres before the backend starts.
//
// Usage:
//   DATABASE_URL=postgres://... node dist/migrate.js
//   MIGRATIONS_DIR=/path/to/migrations node dist/migrate.js   # override dir
//   MIGRATE_MAX_WAIT_MS=120000 node dist/migrate.js           # connection wait
//
// Each migration runs in its own transaction: a failure rolls back that file
// and leaves the schema unchanged. The initial connection is retried so the
// runner can start before Postgres is ready (as in the K8s Job).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/migrate.js -> ../src/migrations (tsc does not copy .sql files to dist).
const defaultDir = path.join(here, '..', 'src', 'migrations');
const migrationsDir = process.env.MIGRATIONS_DIR ?? defaultDir;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://localhost:5432/ai_platform';
const maxWaitMs = parseInt(process.env.MIGRATE_MAX_WAIT_MS ?? '120000', 10);
const retryDelayMs = 2000;

const RETRYABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);

function isRetryable(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e.code && RETRYABLE.has(e.code)) return true;
  return /timeout|refused|terminat|temporarily unavailable/i.test(e.message ?? '');
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || Date.now() >= deadline) throw err;
      const e = err as { code?: string; message?: string };
      console.log(`${label}: not ready yet (${e.code ?? e.message}); retrying in ${retryDelayMs}ms`);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await withRetry(
      () =>
        pool.query(`
          CREATE TABLE IF NOT EXISTS schema_migrations (
            name       TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `),
      'connecting to database',
    );

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await pool.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name as string));

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
        count++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    console.log(count === 0 ? 'up to date (no new migrations)' : `applied ${count} migration(s)`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
