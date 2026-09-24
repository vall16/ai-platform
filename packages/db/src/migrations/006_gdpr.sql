-- 006_gdpr.sql — GDPR support (right to erasure + privacy webhook mapping)
-- Target: PostgreSQL 15+
--
-- Adds to `tenant`:
--   * deleted_at  — soft-delete timestamp set when a tenant exercises the
--                   right to erasure (data is removed, the row is kept as an
--                   audit marker so we can prove the deletion happened).
--   * shop_domain — the merchant's shop domain (e.g. "myshop.myshopify.com"),
--                   used to map Shopify privacy webhooks (customers/redact,
--                   customers/data_request, shop/redact) to the owning tenant.

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS shop_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_tenant_shop_domain ON tenant (shop_domain);
