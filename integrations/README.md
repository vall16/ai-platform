# Integrations

Adapters per piattaforme esterne: WordPress, Shopify, WooCommerce.

Ogni integrazione è un workspace npm separato:
- `integrations/wordpress-plugin/` — **AI Persona** (plugin WordPress)
- `integrations/shopify-app/` — **AI Salesperson** (Shopify theme app extension)
- `integrations/woocommerce-plugin/` — **AI Salesperson** (plugin WooCommerce)

## Due approcci front-end

**Widget browser (vanilla JS, no build step).** I widget che girano dentro le
piattaforme (WordPress, Shopify, WooCommerce) sono JavaScript vanilla autocontenuto,
senza bundler: leggono una config iniettata dalla piattaforma (`window.*Config`),
gestiscono la sessione, i messaggi, l'input vocale (Web Speech API) e il rendering.
Questo è coerente con la convenzione del plugin WordPress esistente.

- Il widget **AI Salesperson** è **condiviso** tra Shopify e WooCommerce:
  `integrations/shopify-app/assets/ai-salesperson.js` e
  `integrations/woocommerce-plugin/assets/js/ai-salesperson.js` sono **identici
  byte-per-byte** — mantenerli sincronizzati quando si modifica uno dei due.
- Il widget **AI Persona** (WordPress) è separato: `integrations/wordpress-plugin/assets/js/widget.js`.

**`@ai-platform/connector-sdk`** (`packages/connector-sdk/`). Client transport-agnostic
tipato con sessioni, messaggi, input vocale, errori tipizzati e un mock offline
(`createMockBackend()`). È il punto d'ingresso per i consumer che vogliono un build
step e un'API tipata (app mobile, siti custom, Webflow/Wix/Squarespace in futuro).
I widget vanilla sopra non lo usano: sono autocontenuti per essere installabili
senza toolchain. Vedi `packages/connector-sdk/README.md`.

## Autenticazione

Tutti i widget inviano `Authorization: Bearer <api_key>` a ogni richiesta. Non c'è
OAuth lato client: il merchant incolla un token (API key del tenant dal Control Room,
più — per il catalogo live — le credenziali dell'API della piattaforma: WooCommerce
REST consumer key/secret o Shopify Admin API access token). È il **backend SaaS** a
chiamare le Admin API della piattaforma, non lo storefront.

> **Demo mode:** se le credenziali della piattaforma sono vuote, il widget omette
> `shop_url`/`shop_credentials` e il backend usa un catalogo mock.
