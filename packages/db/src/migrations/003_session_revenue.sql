-- 003: per-session revenue attribution (Phase 1).
--
-- A flat per-session price (config SESSION_PRICE_MICRO_USD) is stamped onto the
-- session at creation time. The Control Room aggregates revenue (session) and
-- cost (usage_ledger) to compute gross margin. Real per-product pricing lands
-- in Phase 2/4; this is the minimal reversible model that unblocks margin.

ALTER TABLE session ADD COLUMN revenue_micro_usd BIGINT NOT NULL DEFAULT 0;
