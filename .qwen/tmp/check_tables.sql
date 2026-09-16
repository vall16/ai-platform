SELECT 'tenant' AS tbl, count(*) AS n FROM tenant
UNION ALL
SELECT 'api_key', count(*) FROM api_key;

SELECT data_type FROM information_schema.columns
WHERE table_name = 'usage_ledger' AND column_name = 'provider_id';
