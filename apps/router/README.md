# Inference Router (Go)

Stateless routing engine. API `/api/v1/route`, scoring, provider abstraction, failover.

> Go non è installato in ambiente corrente — il codice viene scritto ma non compilato finché Go non è disponibile.

## Struttura prevista

```
apps/router/
├── go.mod
├── cmd/
│   └── router/
│       └── main.go
├── internal/
│   ├── api/
│   ├── scoring/
│   ├── provider/
│   └── config/
└── mock/
```
