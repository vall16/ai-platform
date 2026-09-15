// Bootstrap a local tenant + its first API key directly in Postgres.
//
// Why this exists: the API cannot create the very first key — `POST /tenants`
// needs no auth, but `POST /tenants/:id/api-keys` (which generates a key)
// requires auth. So the first key is seeded here, mirroring ApiKeyService's
// scheme (plaintext = prefix + 32 random bytes hex; stored as SHA-256 hash).
//
// The plaintext key is printed ONCE and is not retrievable later (only its hash
// is stored). Copy it now.
//
// Usage:
//   DATABASE_URL=postgres://localhost:5432/ai_platform node scripts/bootstrap.mjs
//   node scripts/bootstrap.mjs --name "My Site" --slug my-site --label wp-widget
//
// Each run creates a NEW key for the (reused or newly created) tenant.

import { Pool } from 'pg';
import { randomBytes, createHash } from 'node:crypto';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://localhost:5432/ai_platform';
const keyPrefix = process.env.API_KEY_PREFIX ?? 'sk_live_';
const name = arg('name', process.env.BOOTSTRAP_TENANT_NAME ?? 'Local Dev');
const slug = arg('slug', process.env.BOOTSTRAP_TENANT_SLUG ?? 'local-dev');
const label = arg('label', process.env.BOOTSTRAP_KEY_LABEL ?? 'bootstrap');

const pool = new Pool({ connectionString: databaseUrl });

try {
  // 1. Create or reuse the tenant (matched by unique slug).
  let tenant = (await pool.query('SELECT id, name, slug, status FROM tenant WHERE slug = $1', [slug])).rows[0];
  if (!tenant) {
    tenant = (
      await pool.query(
        'INSERT INTO tenant (name, slug) VALUES ($1, $2) RETURNING id, name, slug, status',
        [name, slug],
      )
    ).rows[0];
    console.log(`Created tenant: ${tenant.name} (${tenant.slug}) id=${tenant.id}`);
  } else {
    console.log(`Reusing tenant: ${tenant.name} (${tenant.slug}) id=${tenant.id}`);
  }

  // 2. Generate the first API key (same scheme as ApiKeyService.generate).
  const secret = randomBytes(32).toString('hex');
  const plaintext = `${keyPrefix}${secret}`;
  const keyHash = createHash('sha256').update(plaintext).digest('hex');
  const prefix = plaintext.slice(0, 12);

  await pool.query(
    'INSERT INTO api_key (tenant_id, key_hash, prefix, label) VALUES ($1, $2, $3, $4)',
    [tenant.id, keyHash, prefix, label],
  );

  console.log('\n--- API key (shown once — copy it now) ---');
  console.log(plaintext);
  console.log('-------------------------------------------');
  console.log(`\nUse it as:  Authorization: Bearer ${plaintext}`);
} finally {
  await pool.end();
}
