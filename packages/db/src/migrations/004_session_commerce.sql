-- 004: per-session commerce attribution (Phase 2 — AI Salesperson).
--
-- Tracks the commercial impact of a salesperson session, attributed to the AI
-- agent's actions during the conversation:
--   cart_additions       — number of add-to-cart actions the agent performed
--   orders_influenced    — number of checkouts the agent started
--   revenue_influenced   — cart value (micro USD) at the time of each checkout
--
-- These are "influenced" metrics (the agent drove the action; the customer
-- completes the purchase on the store). The Control Room aggregates them
-- alongside revenue (session) and cost (usage_ledger) for the salesperson P&L.

ALTER TABLE session ADD COLUMN cart_additions     INT    NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN orders_influenced  INT    NOT NULL DEFAULT 0;
ALTER TABLE session ADD COLUMN revenue_influenced BIGINT NOT NULL DEFAULT 0;
