# Monitoring — Prometheus + ServiceMonitor + Grafana

Osservabilità della piattaforma su Kubernetes, basata su **kube-prometheus-stack**
(Helm). Il chart installa il Prometheus Operator, Prometheus, Grafana e
Alertmanager; i `ServiceMonitor` di questo directory dicono a Prometheus quali
servizi scraipare, e il dashboard Grafana è caricato automaticamente dal sidecar.

## Cosa viene monitorato

| Servizio | Endpoint | Metriche |
|----------|----------|----------|
| `backend` (Fastify) | `GET /metrics` :3000 | `http_requests_total`, `http_request_duration_seconds` (histogram), `active_sessions` |
| `router` (Go) | `GET /metrics` :8080 | `router_route_requests_total`, `router_route_duration_seconds` (histogram), `router_provider_outcomes_total` |

Entrambi gli endpoint `/metrics` sono self-contained (nessuna lib client) e
rendono il formato testo Prometheus standard.

## File

| File | Scopo |
|------|-------|
| `kube-prometheus-stack.values.yaml` | Values Helm (namespace, retention, risorse, sidecar Grafana) |
| `80-servicemonitors.yaml` | ServiceMonitor per `backend` e `router` |
| `90-grafana-dashboard.yaml` | ConfigMap con il dashboard "AI Platform" (label `grafana_dashboard="1"`) |

## Prerequisiti

- `helm` e `kubectl` configurati sul cluster.
- L'applicazione già deployata (`infra/k8s/` — namespace `ai-platform`,
  Service `backend:3000` e `router:8080`).

## Installazione

```bash
# 1. Aggiungi il repo Helm (una volta).
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# 2. Installa lo stack nel namespace dell'app.
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  -n ai-platform \
  --create-namespace \
  -f infra/k8s/monitoring/kube-prometheus-stack.values.yaml

# 3. Attendi che il release sia pronto.
kubectl -n ai-platform wait --for=condition=available deployment/monitoring-prometheus --timeout=300s

# 4. Registra i ServiceMonitor e il dashboard Grafana.
kubectl apply -f infra/k8s/monitoring/80-servicemonitors.yaml
kubectl apply -f infra/k8s/monitoring/90-grafana-dashboard.yaml
```

## Verifica

```bash
# ServiceMonitor registrati.
kubectl -n ai-platform get servicemonitor

# Target scraipati da Prometheus (backend + router devono essere "up").
kubectl -n ai-platform exec deploy/monitoring-prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/targets' | python -m json.tool | less

# Metriche grezze direttamente dai pod.
kubectl -n ai-platform port-forward svc/backend 3000:3000 &
curl -s localhost:3000/metrics | head
kubectl -n ai-platform port-forward svc/router 8080:8080 &
curl -s localhost:8080/metrics | head
```

## Accedere a Grafana

Grafana è esposto come `ClusterIP`. Per usarlo in locale:

```bash
# Port-forward del servizio Grafana.
kubectl -n ai-platform port-forward svc/monitoring-grafana 3001:3000
```

Apri http://localhost:3001. Utente: `admin`. La password è generata
randomicamente dal chart e salvata in un Secret:

```bash
kubectl -n ai-platform get secret monitoring-grafana \
  -o jsonpath="{.data.admin-password}" | base64 --decode
```

Il dashboard **"AI Platform"** appare nella lista (tag `ai-platform`), caricato
automaticamente dal sidecar grazie alla label `grafana_dashboard="1"` sul
ConfigMap.

Per esporre Grafana via ingress, sblocca la sezione `grafana.ingress` in
`kube-prometheus-stack.values.yaml`.

## Rimozione

```bash
kubectl delete -f infra/k8s/monitoring/90-grafana-dashboard.yaml
kubectl delete -f infra/k8s/monitoring/80-servicemonitors.yaml
helm uninstall monitoring -n ai-platform
```
