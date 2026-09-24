# Roadmap — AI Platform

> Stato: **Phase 4 in corso (2026-09-24)** — graceful degradation (test 131) + pricing avanzato (test 132) + GDPR completo (test 133) verdi · Prossime: Router HA/Redis, SDK connectors, K8s · Aggiornato: 2026-09-24
> Documento vivo: aggiornare a fine fase.

## 1. Visione e principi invariabili

- **Piattaforma SaaS multi-tenant, provider-agnostic.** Stessa infrastruttura AI/voce/avatar/billing/monitoring per tutti i prodotti.
- **Due prodotti, un motore:**
  - **AI Persona** (WordPress) — "un'AI version of you": avatar conversazionale, voce realtime, personalità configurabile, conoscenza del sito via tool live.
  - **AI Salesperson** (Shopify/WooCommerce) — "un AI salesperson": catalogo, carrello, checkout, upsell, revenue attribution.
- **IP core (mai trattato come utility):** Inference Router + Cost Ledger + Monitoring + Provider abstraction. Vantaggio competitivo = offrire la stessa esperienza AI mantenendo automaticamente il miglior rapporto costo/qualità/latenza/disponibilità.
- **Vincolo architetturale:** mai accoppiare provider ↔ business logic. Ogni provider è un adapter intercambiabile. WordPress/Shopify/Woo non parlano mai direttamente con HeyGen/OpenAI/Deepgram.
- **Production-ready dal giorno 1:** multi-tenancy, concorrenza elevata, failover, misurazione economica di ogni conversazione.

## 2. Fasi

### Phase 0 — Fondamenta (completata)
**Obiettivo:** contratti, schema, struttura. Zero dipendenze da provider reali. Tutto testabile con mock.

- Monorepo (npm workspaces) + struttura `apps/ packages/ integrations/ infra/`
- Contratti TS: `AvatarProvider`, `VoiceProvider`, `STTProvider`/`LLMProvider`/`TTSProvider`, `CommerceProvider`, `BillingProvider`
- Schema DB core: `tenant`, `provider`, `provider_account`, `pricing`, `usage_ledger`, `routing_decision`, `session`
- Router Go: skeleton — API `/api/v1/route`, scoring engine, provider abstraction, mock provider
- Mock provider (TS + Go) per sviluppare senza API reali
- Roadmap + ADR (decisioni architetturali)

**Done when:** `tsc` passa; schema applicabile a Postgres; router compila (quando Go disponibile); mock funzionanti; test di isolamento tenant verdi.

**Stato (2026-09-15):** lato TypeScript completato — contratti, schema core, Cost Ledger e mock-providers compilano e i mock funzionano. Il router Go è scritto ma non compilato (Go non disponibile in ambiente).

### Phase 1 — MVP: AI Persona su WordPress (completata)
**Obiettivo:** un flusso end-to-end reale, un solo prodotto, 1–2 provider.

**Stato (2026-09-22):** **completata** — acceptance test 125 verde (11 check end-to-end), provider health nel Control Room; l'unico item aperto è l'avatar, de-scoped e opzionale. De-scoped su chatbot — pipeline conversazione + TTS senza avatar realtime (l'avatar resta opzionale nel design di AgentCore). Fatto: Agent Core (conversazione, memoria in-sessione, tool `search_posts`/`get_post`, prompting) con mock LLM e test unitari; SaaS backend session manager + endpoint `POST /sessions/:id/messages`, `POST /sessions/:id/audio` (input vocale: STT→LLM→TTS, costo STT a ledger) e `GET /sessions/:id/audio/:audioId`; Cost Ledger per-session (llm/tts/stt) + **revenue per sessione e gross margin** (prezzo fisso `SESSION_PRICE_MICRO_USD` su `session.revenue_micro_usd`, aggregato nel Control Room); **Control Room v0** (API overview + dashboard self-contained, card margin reale); **billing Stripe** (subscribe/cancel/webhook); **observability** (registry Prometheus self-contained, endpoint `/metrics`); **content tool bridge** (provider WordPress REST con `site_url` per sessione + fallback mock); plugin WordPress (API base configurabile, validazione chiave reale, CORS, error handling); **router Go** (compila + `go vet` + test; scoring cost/latency/reliability + health check, **quota-aware routing, circuit breaker e failover**, verificato end-to-end con mock provider via HTTP); **observability** (OTel `trace_id` end-to-end: W3C `traceparent` continuato/emesso da router Go e backend, header `X-Trace-Id`, log strutturati JSON con `trace_id` nel router, helper W3C + test unitari in entrambi i linguaggi); **e2e completo** (test end-to-end del flusso chatbot attraverso il layer HTTP Fastify reale via `app.inject()` con pool fake: auth, ciclo di vita sessione, messaggio con `traceparent` W3C che verifica la continuità di trace, audio, persistenza costo/ledger, errori 401/404).

- SaaS backend: tenant, auth, billing (Stripe), session manager
- Agent Core: conversazione, memoria in-sessione, tool invocation (`search_posts`, `get_post`, …), prompting
- Plugin WordPress: installer, auth bridge, widget injector, content tool bridge
- Router: scoring base (cost + latency + reliability), quota-aware, circuit breaker, failover
- Cost Ledger: per-session (avatar/stt/llm/tts/infra → total, revenue, gross margin)
- Voice/Avatar: 1 pipeline (realtime oppure STT→LLM→TTS), 1–2 provider avatar
- Observability: OTel `trace_id` end-to-end, Prometheus, log strutturati
- Control Room v0: sessioni attive, cost/min, margin, provider health

**Da fare (Phase 1):**
- [x] **Suite di acceptance "test 125 (AI Persona)"** — criterio formale di chiusura; definita (`test/acceptance-125.mjs`) e verde: 11 check end-to-end sul layer HTTP Fastify reale (auth, ciclo di vita sessione, conversazione testo LLM+tool+TTS, input vocale STT, costo/ledger llm/tts/stt, revenue+gross margin, provider health, continuità trace W3C, isolamento multi-tenant, close, 404).
- [x] **Cost Ledger per-session: revenue + gross margin** — prezzo fisso per sessione (`SESSION_PRICE_MICRO_USD`) stampato su `session.revenue_micro_usd` alla creazione (migrazione `003`); il Control Room aggrega revenue (session) + cost (usage_ledger) → gross margin, `margin.available = true`. Pricing per-prodotto reale in Phase 2/4.
- [x] **STT (input vocale)** — endpoint `POST /sessions/:id/audio` (body audio raw) → `AgentCore.transcribe` (STT, costo a ledger) → `handleMessage` (LLM→TTS); `AgentService.sendAudio` somma costo STT+turno sul totale sessione; `MockSTTProvider` cablato nel factory, adapter Deepgram pronto per il live.
- [x] **Control Room v0: provider health** — `provider_health[]` nell'overview: i provider live cablati (LLM/TTS/STT, +avatar se configurato) sono probed via `getHealth()`; un provider che fallisce è riportato `unhealthy` con detail senza rompere l'overview; sezione "Provider — health" nella dashboard; test unitario (healthy + failing).
- [ ] *(opzionale)* **Avatar** — de-scoped; 1–2 provider avatar, resta opzionale nel design di AgentCore.

**Acceptance:** test 125 (AI Persona) verde. ✅ (2026-09-22)
**Out of scope:** H200, shadow routing, benchmarking, what-if, AI Salesperson.

### Phase 2 — AI Salesperson + Cost Ledger completo (completata)
**Obiettivo:** secondo prodotto (AI Salesperson su Shopify/WooCommerce) + Cost Ledger completo (quota prepagata, economics marginal vs accounting).

**Stato (2026-09-23):** **completata** — acceptance test 126 (AI Salesperson) + 129 (quota prepagata) verdi. Fatto: **Commerce Core** (`ShopifyAdapter` GraphQL Admin API + `WooCommerceAdapter` REST + `CommerceBridge` live/mock); **commerce tools** in AgentCore (`search_products`, `get_product`, `add_to_cart`, `start_checkout`) con loop tool per sessioni salesperson; **MockCommerceToolProvider** (catalogo + carrello in-memory) per sviluppo offline; **backend** (factory commerce, session creation con campi shop persistiti in metadata, `AgentService` che persiste l'attribution e consuma la quota); **revenue attribution** (colonne `cart_additions`/`orders_influenced`/`revenue_influenced` su `session`, tracking in AgentCore, persistenza in AgentService, aggregazione nel Control Room); **Cost Ledger completo** (schema `tenant_quota`, `QuotaService` con setQuota/getBalance/assertAvailable/consume/getEconomics, config `QUOTA_FIXED_COST_MICRO_USD`, wiring nel backend, route billing `POST/GET /api/v1/billing/quota`); **quota prepagata** (gate 402 `quota_exhausted` alla creazione, consumo del costo marginale per messaggio, economics marginal vs accounting cost + gross margin).

- Commerce Core + `ShopifyAdapter` + `WooCommerceAdapter`
- Shopify app (theme extension + app embed block) + plugin WooCommerce
- Commerce tools (`search_products`, `add_to_cart`, `start_checkout`, …)
- Revenue attribution (`cart_additions`, `orders_influenced`, `revenue_influenced`)
- Cost Ledger completo: marginal vs accounting cost, prepaid quota economics, historical pricing
- Routing: policy per piano, capacity routing, cost-aware (`EstimatedSessionCost`)
- Control Room v1: provider monitor, routing chart, cost/margin monitor, alerting
- Merchant dashboard: analytics per prodotto

**Da fare (Phase 2):**
- [x] **Commerce Core + adapter** — `ShopifyAdapter` (GraphQL Admin API) + `WooCommerceAdapter` (REST) + `CommerceBridge` (live se la sessione porta `shop_url`, mock altrimenti); spec API documentate.
- [x] **Commerce tools** — `search_products`, `get_product`, `add_to_cart`, `start_checkout` in AgentCore; loop tool per sessioni salesperson; `MockCommerceToolProvider` offline.
- [x] **Revenue attribution** — colonne `cart_additions`/`orders_influenced`/`revenue_influenced` su `session`; tracking in AgentCore, persistenza in AgentService, aggregazione nel Control Room.
- [x] **Cost Ledger completo: quota prepagata** — schema `tenant_quota`, `QuotaService` (setQuota/getBalance/assertAvailable/consume/getEconomics), config `QUOTA_FIXED_COST_MICRO_USD`, gate 402 `quota_exhausted`, consumo del costo marginale per messaggio, economics marginal vs accounting cost + gross margin; route billing `POST/GET /api/v1/billing/quota`.
- [ ] **Shopify app + plugin WooCommerce** — theme extension, app embed block, installer (da fare).
- [ ] **Routing cost-aware + Control Room v1 + merchant dashboard** — policy per piano, capacity routing, `EstimatedSessionCost`, routing chart, alerting, analytics per prodotto, historical pricing (da fare).

**Acceptance:** test 126 (AI Salesperson) + 129 (prepaid quota) verdi. ✅ (2026-09-23)
**Out of scope (spostato):** Shopify app UI, routing cost-aware, Control Room v1, merchant dashboard, historical pricing.

### Phase 3 — Routing avanzato + Self-hosted (completata)
**Obiettivo:** routing avanzato (objective-based) + self-hosted GPU con economics dinamiche.

**Stato (2026-09-23):** **completata** — acceptance test 127 (router failover) + 128 (H200 self-hosted) + 130 (profitability) verdi. Fatto: **SelfHostedAvatarProvider** (H200/H100/B200, nuovo package `@ai-platform/self-hosted`) con pricing per sessione basato sull'utilizzo corrente; **dynamic economics** (`SelfHostedEconomics`: utilization → effective cost/min, costo per sessione che scende al salire dell'utilizzo); **cost allocation** (`CostAllocator`: fixed cost → true realized cost/min + ripartizione proporzionale per sessione); **routing objective** (`selectProvider`: `MINIMIZE_MARGINAL_COST` / `MAXIMIZE_GROSS_MARGIN`); **router failover** (test Go end-to-end: health/circuit/quota + cascading multi-gate).

- [x] **SelfHostedAvatarProvider (H200/H100/B200) + dynamic economics** — nuovo package `@ai-platform/self-hosted`; pricing per sessione = costo fisso orario GPU ammortizzato sulle sessioni attive (utilization → effective cost/min).
- [x] **Cost allocation** — `CostAllocator.trueRealizedCostPerMin` (fixed cost / minuti reali) + `allocate` (ripartizione proporzionale per durata).
- [x] **Routing objective** — `selectProvider(MINIMIZE_MARGINAL_COST | MAXIMIZE_GROSS_MARGIN)`.
- [x] **Router failover (test 127)** — test Go acceptance: selezione best, failover su health/circuit/quota, cascading multi-gate, riserva quota, errore se nessun provider.
- [ ] **Shadow routing + provider benchmarking** (job automatico) — da fare.
- [ ] **Cost/usage anomaly detection, abuse/fraud protection** — da fare.
- [ ] **What-if simulation (routing simulation)** — da fare.
- [ ] **Region routing (EU/US/Asia), data residency** — da fare.

**Acceptance:** test 127 (router failover) + 128 (H200) + 130 (profitability) verdi. ✅ (2026-09-23)
**Out of scope (spostato):** shadow routing, benchmarking, anomaly detection, what-if, region routing.

### Phase 4 — Scale, HA, espansione (in corso)
**Obiettivo:** scalabilità e alta disponibilità, pricing avanzato, conformità GDPR, SDK per connector futuri, deployment.

**Stato (2026-09-24):** **in corso** — acceptance test 131 (graceful degradation) + 132 (pricing avanzato) + 133 (GDPR completo) verdi. Fatto: **graceful degradation completa** (router: `mode` full/degraded/best_effort + `degradation_level` + best-effort fallback come safety net quando tutti i provider primari sono giù); **pricing avanzato** (cost-ledger: `PricingEngine` con modelli flat / per-unit / revenue-based / hybrid / tiered + volume discount); **GDPR completo** (diritti del data subject: export/portabilità, erasure, retention + Shopify privacy webhooks HMAC-verified).

- [x] **Graceful degradation completa (cascata fallback)** — router Go: il risultato di routing espone `mode` (`full`/`degraded`/`best_effort`) e `degradation_level` (profondità della cascata); `SetBestEffort` designa un safety net selezionato (con quota riservata) quando nessun provider primario è eleggibile, invece di fallire. Test 131 (8 subtest).
- [x] **Pricing avanzato** — cost-ledger `PricingEngine`: modelli `flat`, `per_unit`, `revenue_based` (% di revenue), `hybrid` (base + per-unit + revenue share), `tiered` (fasce volumetriche) + `volumeDiscount` (sconto sulla parte variabile, mai sulla base fissa). Test 132.
- [ ] **Router HA (scaling orizzontale, coordinamento Redis), load test 1k/10k sessioni** — da fare.
- [x] **GDPR completo (export, deletion, retention), Shopify privacy webhooks** — `GdprService` (saas-backend): right of access/portability (`exportTenantData`/`exportCustomerData`), right to erasure (`deleteTenantData` soft-delete + `deleteCustomerData`), storage limitation (`purgeExpired` cron); migrazione `006` (`tenant.deleted_at`, `tenant.shop_domain`); route `GET /api/v1/gdpr/export`, `POST /api/v1/gdpr/delete`, `POST /api/v1/gdpr/retention/purge`; **Shopify privacy webhooks** `customers/data_request`/`customers/redact`/`shop/redact` su `POST /api/v1/webhooks/shopify/privacy` con verifica HMAC-SHA256 (raw body, `timingSafeEqual`) e routing shop→tenant via `shop_domain`. Test 133 (10 check).
- [ ] **SDK per future connectors (Webflow, Wix, Squarespace, custom, mobile)** — da fare.
- [ ] **Deployment Kubernetes** — da fare.

**Acceptance (parziale):** test 131 (graceful degradation) + 132 (pricing avanzato) + 133 (GDPR completo) verdi. ✅ (2026-09-24)
**Out of scope (spostato):** Router HA/Redis, load test, SDK connectors, K8s.

## 3. Workstream (paralleli)

| Workstream | Contenuto |
|---|---|
| Platform Core | tenant, auth, billing, session manager |
| Inference Router | Go, stateless, scoring, failover |
| Voice/Avatar | pipeline, provider abstraction |
| Commerce | core + adapter Shopify/Woo |
| Billing/Usage/Cost Ledger | pricing, usage, profitability |
| Observability | OTel, Prometheus, Grafana, Loki |
| Integrations | plugin WP, app Shopify, plugin Woo |
| Dashboards | merchant + control room |

## 4. Rischi principali e mitigazioni

1. **Time-to-market** → sequenziare aggressivamente; MVP = 1 prodotto, 1–2 provider.
2. **Realtime voice + avatar** (barge-in, lip-sync, latenza) → è il collo di bottiglia; isolare dietro `VoiceProvider`; partire con 1 pipeline.
3. **Accuratezza Cost Ledger** → le tabelle prezzi driftano dal billing reale; processo di riconciliazione periodica.
4. **Isolamento multi-tenant** → row-level security a livello data layer + test di isolamento dedicati.
5. **Complessità Go/TS** → RPC versionato, API stabile `/api/v1`, contratti condivisi.

## 5. Regole di sequenziamento

- Ogni fase lascia un sistema **funzionante e testabile**.
- L'IP (router/ledger/abstraction) non si tocca con shortcut.
- Ogni provider nuovo = **adapter + capability config**, non modifiche al sistema.
- Mock sempre disponibili per sviluppare senza spendere API.
- Non si introduce codice fittizio/placeholder: interfacce + adapter + config + mock + test + env documentate.

## 6. North star metrics

- **AI Persona:** engaged conversations, returning users, cost per conversation, revenue per active site.
- **AI Salesperson:** AI-assisted GMV.
- *Non* sono metriche primarie: messages, minutes, installazioni da sole.

## 7. Note tecniche

- **Stack:** TypeScript/Node (SaaS + business logic), Go (router), Postgres, Redis, WebSocket/WebRTC, S3, queue, Docker, OTel/Prometheus/Grafana/Loki.
- **Package manager:** npm (workspaces) — pnpm non installato in ambiente.
- **Go:** Go 1.27.1 installato in `C:\Users\crist\go-sdk` (bin nel PATH utente). Il router compila (`go build`), passa `go vet` e risponde end-to-end (`/api/v1/health`, `/api/v1/providers`, `/api/v1/route`) con mock provider. Build: `go build -o router.exe ./cmd/router` da `apps/router`.
- **Nomi/identificatori** in inglese; documentazione in italiano.
