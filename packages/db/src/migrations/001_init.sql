-- 001_init.sql — Core schema for AI Platform
-- Target: PostgreSQL 15+
-- Requires: pgcrypto (for gen_random_uuid)

-- ============================================================
-- tenant
-- ============================================================
CREATE TABLE tenant (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- provider
-- ============================================================
CREATE TABLE provider (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL
              CHECK (type IN ('avatar', 'voice', 'stt', 'llm', 'tts', 'commerce', 'billing')),
  base_url    TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'inactive', 'deprecated')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- provider_account (tenant ↔ provider credentials)
-- ============================================================
CREATE TABLE provider_account (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  provider_id         UUID NOT NULL REFERENCES provider(id) ON DELETE CASCADE,
  api_key_encrypted   BYTEA,
  config              JSONB NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_id)
);

CREATE INDEX idx_provider_account_tenant ON provider_account (tenant_id);

-- ============================================================
-- pricing (per-provider, per-resource cost rules)
-- ============================================================
CREATE TABLE pricing (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     UUID NOT NULL REFERENCES provider(id) ON DELETE CASCADE,
  resource_type   TEXT NOT NULL,
  unit            TEXT NOT NULL
                  CHECK (unit IN ('token', 'second', 'request', 'byte', 'session')),
  cost_micro_usd  BIGINT NOT NULL CHECK (cost_micro_usd >= 0),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to    TIMESTAMPTZ
);

CREATE INDEX idx_pricing_provider ON pricing (provider_id, effective_from);

-- ============================================================
-- session (conversation session)
-- ============================================================
CREATE TABLE session (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  product_type          TEXT NOT NULL
                        CHECK (product_type IN ('persona', 'salesperson')),
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'abandoned', 'error')),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  total_cost_micro_usd  BIGINT NOT NULL DEFAULT 0,
  metadata              JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_session_tenant_status ON session (tenant_id, status);
CREATE INDEX idx_session_tenant_started ON session (tenant_id, started_at DESC);

-- ============================================================
-- usage_ledger (Cost Ledger — every cost event)
-- ============================================================
CREATE TABLE usage_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  session_id      UUID REFERENCES session(id) ON DELETE SET NULL,
  provider_id     UUID NOT NULL REFERENCES provider(id) ON DELETE CASCADE,
  resource_type   TEXT NOT NULL,
  cost_micro_usd  BIGINT NOT NULL CHECK (cost_micro_usd >= 0),
  quantity        BIGINT NOT NULL DEFAULT 1,
  unit            TEXT NOT NULL
                  CHECK (unit IN ('token', 'second', 'request', 'byte', 'session')),
  trace_id        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_ledger_tenant_time ON usage_ledger (tenant_id, created_at DESC);
CREATE INDEX idx_usage_ledger_session ON usage_ledger (session_id);
CREATE INDEX idx_usage_ledger_provider ON usage_ledger (provider_id, created_at DESC);

-- ============================================================
-- routing_decision (why the router chose a provider)
-- ============================================================
CREATE TABLE routing_decision (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  session_id              UUID REFERENCES session(id) ON DELETE SET NULL,
  request_id              TEXT NOT NULL,
  resource_type           TEXT NOT NULL,
  selected_provider_id    UUID NOT NULL REFERENCES provider(id) ON DELETE CASCADE,
  score                   NUMERIC NOT NULL,
  candidates              JSONB NOT NULL DEFAULT '[]',
  reason                  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_routing_decision_tenant_time ON routing_decision (tenant_id, created_at DESC);
CREATE INDEX idx_routing_decision_session ON routing_decision (session_id);
