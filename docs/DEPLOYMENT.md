# Deployment — AI Platform

Guida completa al deployment: sviluppo locale e produzione su Kubernetes.
Tutto il materiale vive in `infra/` (Dockerfile, docker-compose, manifest K8s, monitoring).

## Panoramica

| Servizio | Stack | Porta | Note |
|---|---|---|---|
| **backend** | TypeScript/Node (Fastify) | 3000 | SaaS: tenant, auth, billing, session, agent, dashboards |
| **router** | Go (stdlib-only) | 8080 | Inference Router stateless; quota/circuit-breaker in Redis |
| **postgres** | Postgres 15 | 5432 | Stato persistente (StatefulSet + PVC) |
| **redis** | Redis 7 | 6379 | Stato condiviso del router (effimero) |

Il backend chiama le Admin API delle piattaforme (Shopify/Woo/WordPress); i
connector front-end (widget WP / app Shopify / plugin Woo) parlano solo col backend.

## Prerequisiti

- **Locale:** Docker + Docker Compose, Node 20+, Go 1.22+ (per il router).
- **Kubernetes:** `kubectl` con accesso a un cluster, un registry immagini
  (ECR/GHCR/Docker Hub/…), `helm` (solo per il monitoring opzionale).
- Un **StorageClass** `ReadWriteOnce` per il PVC di Postgres (vedi Note).

---

## 1. Sviluppo locale

Solo i data store in Docker; il codice gira in locale.

```bash
# 1) Postgres + Redis
docker compose -f infra/docker-compose/docker-compose.yml up -d

# 2) Backend (porta 3000)
DATABASE_URL=postgres://postgres:sa@localhost:5432/ai_platform \
  npm run dev -w @ai-platform/saas-backend

# 3) Router (porta 8080) — in un altro terminale
cd apps/router && go run ./cmd/router
```

Credenziali locali: `postgres / sa / ai_platform` (coerenti con `docs/DATABASE.md`).
Le migrazioni si applicano con il runner di `@ai-platform/db` (vedi §2, passo c).

Verifica rapida:
```bash
curl -s localhost:3000/api/v1/health   # backend
curl -s localhost:8080/api/v1/health   # router
```

---

## 2. Deployment Kubernetes (produzione)

Manifest in `infra/k8s/` (dettaglio per file in `infra/k8s/README.md`).

### a) Build e push delle immagini

Le immagini non sono pubbliche: buildale e spingile nel tuo registry.

```bash
# Backend — build context = ROOT del repo (necessario per i npm workspaces)
docker build -f infra/docker/Dockerfile.backend -t <registry>/ai-platform/backend:latest .

# Router — build context = apps/router
docker build -f infra/docker/Dockerfile.router -t <registry>/ai-platform/router:latest apps/router

docker push <registry>/ai-platform/backend:latest
docker push <registry>/ai-platform/router:latest
```

Se usi nomi/tag diversi da `ai-platform/…:latest`, aggiorna il campo `image:`
in `40-migrate-job.yaml`, `50-backend.yaml`, `60-router.yaml`
(o usa `kubectl set image` dopo l'apply).

### b) Segreti

Sostituisci i placeholder in `30-config.yaml` (`POSTGRES_PASSWORD`,
`DATABASE_URL`, `STRIPE_*`, `SHOPIFY_WEBHOOK_SECRET`). In produzione crea il
Secret fuori dal repo:

```bash
kubectl -n ai-platform create secret generic ai-platform-secrets \
  --from-literal=POSTGRES_PASSWORD='<pwd>' \
  --from-literal=DATABASE_URL='postgres://postgres:<pwd>@postgres:5432/ai_platform' \
  --from-literal=STRIPE_SECRET_KEY='<key>' \
  --from-literal=STRIPE_WEBHOOK_SECRET='<secret>' \
  --from-literal=SHOPIFY_WEBHOOK_SECRET='<secret>'
```

e rimuovi il blocco `stringData` da `30-config.yaml` (oppure usa un secret manager).

### c) Apply

In un colpo solo: il Job `db-migrate` e l'initContainer del backend aspettano
che Postgres sia pronto e che le migrazioni siano applicate, quindi l'ordine è
gestito dai manifest.

```bash
kubectl apply -f infra/k8s/00-namespace.yaml \
  -f infra/k8s/10-postgres.yaml \
  -f infra/k8s/20-redis.yaml \
  -f infra/k8s/30-config.yaml \
  -f infra/k8s/40-migrate-job.yaml \
  -f infra/k8s/50-backend.yaml \
  -f infra/k8s/60-router.yaml

# Ingress — solo se hai un Ingress controller
kubectl apply -f infra/k8s/70-ingress.yaml
```

Ordine dei manifest: `00` namespace → `10` postgres → `20` redis → `30`
config/secret → `40` job migrazioni → `50` backend → `60` router → `70` ingress.

### d) Verifica

```bash
kubectl -n ai-platform get pods,svc
kubectl -n ai-platform get job db-migrate          # deve finire con "Completed"
kubectl -n ai-platform logs job/db-migrate         # "applied N migration(s)" / "up to date"

# Health
kubectl -n ai-platform port-forward svc/backend 3000:3000
curl -s localhost:3000/api/v1/health
kubectl -n ai-platform port-forward svc/router 8080:8080
curl -s localhost:8080/api/v1/health
```

### e) Monitoring (opzionale)

Stack Prometheus + ServiceMonitor + Grafana via Helm
(dettaglio in `infra/k8s/monitoring/README.md`):

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  -n ai-platform --create-namespace \
  -f infra/k8s/monitoring/kube-prometheus-stack.values.yaml
kubectl apply -f infra/k8s/monitoring/80-servicemonitors.yaml
kubectl apply -f infra/k8s/monitoring/90-grafana-dashboard.yaml
```

Scrape: `backend` (`/metrics`:3000) e `router` (`/metrics`:8080). Dashboard
Grafana "AI Platform" caricata dal sidecar.

---

## 3. Riferimento configurazione

### Backend (env)

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | `postgres://localhost:5432/ai_platform` | Connessione Postgres |
| `STRIPE_SECRET_KEY` | `""` | Chiave segreta Stripe |
| `STRIPE_WEBHOOK_SECRET` | `""` | Segreto webhook Stripe |
| `API_KEY_PREFIX` | `sk_live_` | Prefisso delle API key tenant |
| `SESSION_PRICE_MICRO_USD` | `100000` | Prezzo fisso per sessione (micro USD) |
| `QUOTA_FIXED_COST_MICRO_USD` | `0` | Overhead fisso ammortizzato nel costo quota |
| `SHOPIFY_WEBHOOK_SECRET` | `""` | Segreto HMAC per i privacy webhook Shopify |
| `DATA_RETENTION_DAYS` | `365` | Finestra di retention (purge GDPR) |

### Router (env)

| Variabile | Default | Descrizione |
|---|---|---|
| `ROUTER_PORT` | `8080` | Porta HTTP |
| `REDIS_URL` | `redis://redis:6379` | Store condiviso per quota/circuit-breaker (assente → in-memory) |

### Runner migrazioni (immagine backend)

| Variabile | Default | Descrizione |
|---|---|---|
| `MIGRATIONS_DIR` | `/app/packages/db/src/migrations` | Percorso dei `.sql` nell'immagine |
| `MIGRATE_MAX_WAIT_MS` | `120000` | Timeout attesa connessione DB |

---

## 4. Note operative

- **StorageClass**: lo StatefulSet di Postgres crea un PVC `ReadWriteOnce`; se
  il cluster non ha una StorageClass di default, imposta `storageClassName` in
  `10-postgres.yaml`.
- **Immagini pubbliche**: `postgres:15-alpine` e `redis:7-alpine` non vanno
  buildate; solo `backend` e `router` sono tue.
- **Scalabilità**: backend e router sono stateless e scalabili su `replicas`;
  lo stato condiviso del router vive in Redis (fail-open se Redis è down).
- **Rollback migrazioni**: `kubectl -n ai-platform delete job db-migrate` e
  re-apply — le migrazioni sono idempotenti (tracciate in `schema_migrations`).
- **Rollback immagine**: `kubectl -n ai-platform set image deployment/backend
  backend=<registry>/ai-platform/backend:<tag-prec>` (idem per `router`).
- **Secret**: mai commitare valori reali; il blocco `stringData` in
  `30-config.yaml` è solo un placeholder per dev.
