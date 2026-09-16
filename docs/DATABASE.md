# Connessione al database

## Credenziali

| Parametro | Valore |
|---|---|
| Host | `localhost` |
| Porta | `5432` |
| Database | `ai_platform` |
| Utente | `postgres` |
| Password | `sa` |

Connessione come variabile d'ambiente per il backend:

```powershell
$env:DATABASE_URL="postgres://postgres:sa@localhost:5432/ai_platform"
```

## psql

Sessione interattiva:

```powershell
psql -h localhost -U postgres -d ai_platform
```

Comando singolo (senza prompt password):

```powershell
$env:PGPASSWORD="sa"
psql -h localhost -U postgres -d ai_platform -c "\dt"
```

Se `psql` non è in PATH (installazione PostgreSQL 15 standard):

```powershell
$env:PGPASSWORD="sa"
& "C:\Program Files\PostgreSQL\15\bin\psql.exe" -h localhost -U postgres -d ai_platform -c "\dt"
```

## Comandi utili

```sql
\dt                       -- elenca le tabelle
\d tenant                 -- descrive una tabella
\d+ usage_ledger          -- descrive con dettagli
SELECT * FROM tenant;     -- contenuto di una tabella
```

## Migrations

Applicare una migration:

```powershell
$env:PGPASSWORD="sa"
psql -h localhost -U postgres -d ai_platform -f packages/db/src/migrations/001_init.sql
psql -h localhost -U postgres -d ai_platform -f packages/db/src/migrations/002_api_keys.sql
```