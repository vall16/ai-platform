# Integrations

Adapters per piattaforme esterne: WordPress, Shopify, WooCommerce.

Ogni integrazione è un workspace npm separato:
- `integrations/wordpress-plugin/`
- `integrations/shopify-app/`
- `integrations/woocommerce-plugin/`

## SDK condiviso

Tutti i connector front-end (WordPress oggi; Webflow, Wix, Squarespace, siti custom e mobile in futuro) parlano con il backend SaaS attraverso **`@ai-platform/connector-sdk`** (`packages/connector-sdk/`): un client transport-agnostic con sessioni, messaggi, input vocale, errori tipizzati e un mock offline (`createMockBackend()`). Ogni integrazione usa l'SDK invece di reimplementare la logica client — vedi `packages/connector-sdk/README.md`.
