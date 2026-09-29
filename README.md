# AI Platform

Piattaforma SaaS multi-tenant, **provider-agnostic** per avatar conversazionali AI.

## Prodotti

- **AI Persona** — WordPress. "Un'AI version of you": avatar conversazionale, voce realtime, personalità configurabile, conoscenza dei contenuti del sito via tool live.
- **AI Salesperson** — Shopify / WooCommerce. "Un AI salesperson": catalogo, varianti, carrello, checkout, upsell/cross-sell, revenue attribution.

I due prodotti condividono lo stesso motore: inference, voce, avatar, billing, monitoring e routing.

## IP core

Il vantaggio competitivo non è il widget, è il motore dietro:

- **Inference Router** (Go, stateless) — scelta provider per score (costo/latenza/qualità/capacity/affidabilità/quota), failover, circuit breaker.
- **Cost Ledger** — revenue/COGS/gross margin per singola conversazione; marginal vs accounting cost; H200 dynamic economics.
- **Monitoring** — OTel end-to-end, Prometheus, Grafana, Loki; Inference Control Room.
- **Provider abstraction** — ogni provider è un adapter intercambiabile, mai accoppiato alla business logic.

## Documentazione

- [Roadmap](docs/ROADMAP.md)

## Stato

**Phase 6 completata (2026-09-28).** Entrambi i prodotti (AI Persona + AI Salesperson) funzionano end-to-end; sistema di costi/ricavi completo, dashboards (merchant + Control Room v1), routing cost-aware per piano, GDPR, deploy Kubernetes e monitoring. Fornitori ancora simulati (mock), pronti per i servizi reali. Vedi roadmap per scope, fasi e criteri di completamento.
