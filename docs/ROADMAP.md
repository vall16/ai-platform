# Roadmap — AI Platform

> Stato: **Phase 0 — Fondamenta** · Aggiornato: 2026-09-10
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

### Phase 0 — Fondamenta (in corso)
**Obiettivo:** contratti, schema, struttura. Zero dipendenze da provider reali. Tutto testabile con mock.

- Monorepo (npm workspaces) + struttura `apps/ packages/ integrations/ infra/`
- Contratti TS: `AvatarProvider`, `VoiceProvider`, `STTProvider`/`LLMProvider`/`TTSProvider`, `CommerceProvider`, `BillingProvider`
- Schema DB core: `tenant`, `provider`, `provider_account`, `pricing`, `usage_ledger`, `routing_decision`, `session`
- Router Go: skeleton — API `/api/v1/route`, scoring engine, provider abstraction, mock provider
- Mock provider (TS + Go) per sviluppare senza API reali
- Roadmap + ADR (decisioni architetturali)

**Done when:** `tsc` passa; schema applicabile a Postgres; router compila (quando Go disponibile); mock funzionanti; test di isolamento tenant verdi.

### Phase 1 — MVP: AI Persona su WordPress
**Obiettivo:** un flusso end-to-end reale, un solo prodotto, 1–2 provider.

- SaaS backend: tenant, auth, billing (Stripe), session manager
- Agent Core: conversazione, memoria in-sessione, tool invocation (`search_posts`, `get_post`, …), prompting
- Plugin WordPress: installer, auth bridge, widget injector, content tool bridge
- Router: scoring base (cost + latency + reliability), quota-aware, circuit breaker, failover
- Cost Ledger: per-session (avatar/stt/llm/tts/infra → total, revenue, gross margin)
- Voice/Avatar: 1 pipeline (realtime oppure STT→LLM→TTS), 1–2 provider avatar
- Observability: OTel `trace_id` end-to-end, Prometheus, log strutturati
- Control Room v0: sessioni attive, cost/min, margin, provider health

**Acceptance:** test 125 (AI Persona) verde.
**Out of scope:** H200, shadow routing, benchmarking, what-if, AI Salesperson.

### Phase 2 — AI Salesperson + Cost Ledger completo
- Commerce Core + `ShopifyAdapter` + `WooCommerceAdapter`
- Shopify app (theme extension + app embed block) + plugin WooCommerce
- Commerce tools (`search_products`, `add_to_cart`, `start_checkout`, …)
- Revenue attribution (`cart_additions`, `orders_influenced`, `revenue_influenced`)
- Cost Ledger completo: marginal vs accounting cost, prepaid quota economics, historical pricing
- Routing: policy per piano, capacity routing, cost-aware (`EstimatedSessionCost`)
- Control Room v1: provider monitor, routing chart, cost/margin monitor, alerting
- Merchant dashboard: analytics per prodotto

**Acceptance:** test 126 (AI Salesperson) + 129 (prepaid quota) verdi.

### Phase 3 — Routing avanzato + Self-hosted
- `SelfHostedAvatarProvider` (H200/H100/B200) + dynamic economics (utilization → effective cost/min)
- Cost allocation (fixed cost → true realized cost/min)
- Routing objective: `MINIMIZE_MARGINAL_COST` / `MAXIMIZE_GROSS_MARGIN`
- Shadow routing + provider benchmarking (job automatico)
- Cost/usage anomaly detection, abuse/fraud protection
- What-if simulation (routing simulation)
- Region routing (EU/US/Asia), data residency

**Acceptance:** test 127 (router failover) + 128 (H200) + 130 (profitability) verdi.

### Phase 4 — Scale, HA, espansione
- Router HA (scaling orizzontale, coordinamento Redis), load test 1k/10k sessioni
- Graceful degradation completa (cascata fallback)
- GDPR completo (export, deletion, retention), Shopify privacy webhooks
- SDK per future connectors (Webflow, Wix, Squarespace, custom, mobile)
- Pricing avanzato: revenue-based, hybrid, tiered, volume discounts
- Deployment Kubernetes

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
- **Go:** non installato in ambiente corrente → il router viene scritto ma non compilato finché Go non è disponibile.
- **Nomi/identificatori** in inglese; documentazione in italiano.
