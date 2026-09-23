-- 005: prepaid quota per tenant (Phase 2 — Cost Ledger completo).
--
-- A tenant buys a prepaid quota: a budget (micro USD) for a period. As the
-- tenant uses the platform, the marginal (provider) cost of each session is
-- consumed from the quota. When the quota is exhausted, new sessions are
-- rejected (402). The Cost Ledger reports the quota economics: marginal cost
-- (variable provider cost) vs accounting cost (fully-loaded, incl. amortized
-- fixed overhead) and the resulting gross margin on the prepaid revenue.

CREATE TABLE tenant_quota (
  tenant_id       UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  total_micro_usd BIGINT NOT NULL CHECK (total_micro_usd >= 0),
  used_micro_usd  BIGINT NOT NULL DEFAULT 0 CHECK (used_micro_usd >= 0),
  period_start    TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_end      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
