# Deployment Kubernetes

Manifest per deployare la piattaforma su un cluster Kubernetes.

## Componenti

| File | Risorsa | Note |
|---|---|---|
| `00-namespace.yaml` | Namespace `ai-platform` | |
| `10-postgres.yaml` | StatefulSet + Service + PVC | Postgres 15, storage persistente (serve un StorageClass RWO) |
| `20-redis.yaml` | Deployment + Service | Redis 7, coordina quota/circuit-breaker del router (effimero) |
| `30-config.yaml` | ConfigMap + Secret | config non-secreta + segreti (da sostituire) |
| `40-migrate-job.yaml` | Job | applica le migrazioni SQL prima del backend |
| `50-backend.yaml` | Deployment + Service | SaaS backend (2 repliche), initContainer in attesa delle migrazioni |
| `60-router.yaml` | Deployment + Service | router Go stateless (2 repliche) |
| `70-ingress.yaml` | Ingress | **opzionale**, richiede un Ingress controller |

## 1. Build e push delle immagini

Le immagini non sono pubbliche: vanno buildate e spinte nel tuo registry.

```bash
# Backend (build context = root del repo, per i npm workspaces)
docker build -f infra/docker/Dockerfile.backend -t <registry>/ai-platform/backend:latest .

# Router (build context = apps/router)
docker build -f infra/docker/Dockerfile.router -t <registry>/ai-platform/router:latest apps/router

docker push <registry>/ai-platform/backend:latest
docker push <registry>/ai-platform/router:latest
```

Se usi un registry diverso da `ai-platform/...:latest`, aggiorna il campo
`image:` nei file `40`, `50`, `60` (o usa `kubectl set image` dopo l'apply).

## 2. Segreti

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

e rimuovi il blocco `stringData` da `30-config.yaml`.

## 3. Apply

```bash
# Core (senza ingress)
kubectl apply -f infra/k8s/00-namespace.yaml \
  -f infra/k8s/10-postgres.yaml \
  -f infra/k8s/20-redis.yaml \
  -f infra/k8s/30-config.yaml \
  -f infra/k8s/40-migrate-job.yaml \
  -f infra/k8s/50-backend.yaml \
  -f infra/k8s/60-router.yaml

# Ingress (solo se hai un Ingress controller)
kubectl apply -f infra/k8s/70-ingress.yaml
```

Ordine: il Job `db-migrate` e l'initContainer del backend attendono che
Postgres sia pronto e che le migrazioni siano applicate, quindi l'apply può
essere fatto in un colpo solo.

## 4. Verifica

```bash
kubectl -n ai-platform get pods,svc
kubectl -n ai-platform get job db-migrate          # deve finire con Completed
kubectl -n ai-platform logs job/db-migrate         # "applied N migration(s)" / "up to date"

# Health
kubectl -n ai-platform port-forward svc/backend 3000:3000
curl -s localhost:3000/api/v1/health
kubectl -n ai-platform port-forward svc/router 8080:8080
curl -s localhost:8080/api/v1/health
```

## Note

- **StorageClass**: lo StatefulSet di Postgres crea un PVC `ReadWriteOnce`; se
  il cluster non ha un StorageClass di default, imposta `storageClassName` in
  `10-postgres.yaml`.
- **Immagini**: `postgres:15-alpine` e `redis:7-alpine` sono pubbliche.
- **Scalabilità**: backend e router sono stateless e scalabili orizzontalmente
  (`replicas`); lo stato condiviso del router vive in Redis.
- **Rollback**: `kubectl -n ai-platform delete job db-migrate` e re-apply per
  ri-eseguire le migrazioni (idempotenti).
