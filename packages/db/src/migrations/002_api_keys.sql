-- 002_api_keys.sql — API keys + subscription for SaaS onboarding
-- Target: PostgreSQL 15+

-- ============================================================
-- api_key (tenant authentication keys)
-- ============================================================
CREATE TABLE api_key (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL UNIQUE,
  prefix        TEXT NOT NULL,
  label         TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'revoked')),
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_key_tenant ON api_key (tenant_id);
CREATE INDEX idx_api_key_hash ON api_key (key_hash);

-- ============================================================
-- subscription (Stripe billing)
-- ============================================================
CREATE TABLE subscription (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  stripe_customer_id       TEXT,
  stripe_subscription_id   TEXT UNIQUE,
  plan                     TEXT NOT NULL DEFAULT 'starter',
  status                   TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  current_period_end       TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_tenant ON subscription (tenant_id);
