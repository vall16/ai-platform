# Inference Router (Go)

Stateless routing engine. API `/api/v1/route`, scoring, provider abstraction, failover.

> Go 1.27.1 disponibile in `C:\Users\crist\go-sdk` (bin non nel PATH di default). Da `apps/router`: build `"C:\Users\crist\go-sdk\bin\go.exe" build ./...`, test `"C:\Users\crist\go-sdk\bin\go.exe" test ./...`.

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
