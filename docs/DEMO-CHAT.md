# Demo Chat — guida rapida

> Pagina demo per provare il chatbot (AI Persona / AI Salesperson) in locale, con LLM reale (Qwen) e cost ledger reale su Postgres.
> Aggiornato: 2026-09-30

## 1. Cosa è

`GET /demo-chat` serve una pagina web standalone (senza build) che:
1. crea una sessione via API (`POST /api/v1/sessions`),
2. invia i messaggi (`POST /api/v1/sessions/:id/messages`),
3. mostra la risposta testuale + l'audio TTS.

Il pipeline è **reale**: LLM (Qwen), cost ledger (Postgres). TTS/STT e i contenuti sono mock deterministici.

## 2. Prerequisiti

| Dipendenza | Note |
|---|---|
| **Postgres** | DB `ai_platform`, migrazioni applicate. Default locale: `postgres://postgres:postgres@localhost:5432/ai_platform` |
| **LLM Qwen** | Endpoint OpenAI-compatible. Default: `http://192.168.1.145:11434/v1`, modello `qwen3.8-27b` |
| **API key** | Chiave `sk_live_...` del tenant, generata col bootstrap |

### Verifica LLM
```bash
curl http://192.168.1.145:11434/v1/models
# → deve restituire il modello (es. qwen3.8-27b)
```

### Genera una API key (se non ne hai una)
```bash
set "DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_platform"
node apps/saas-backend/scripts/bootstrap.mjs --name "Demo" --slug demo --label demo-chat
# → stampa la chiave sk_live_... (una sola volta)
```

## 3. Avvio

```bash
cd apps/saas-backend
set "DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_platform"
set "LLM_BASE_URL=http://192.168.1.145:11434/v1"
set "LLM_MODEL=qwen3.8-27b"
set "LLM_API_KEY=not-needed"
npm run dev
```

> I valori `LLM_*` sono già i default nel factory (`src/providers/factory.ts`); le variabili servono solo per sovrascriverli.

Apri **`http://localhost:3000/demo-chat`**, incolla la API key, "Connetti" e scrivi.

## 4. Da dove vengono i prodotti

Quando chiedi "che prodotti vendi", i prodotti **non** vengono da un negozio reale: vengono dal **catalogo mock** hardcoded in `packages/mock-providers/src/commerce-provider.ts` (`MOCK_PRODUCTS`):

| Prodotto | Prezzo |
|---|---|
| Wireless Headphones Pro | $199.99 |
| Smart Watch Series 5 | $349.00 |
| USB-C Hub 8-in-1 | $59.99 |
| Mechanical Keyboard RGB | $129.00 (out of stock) |

### Perché il mock
La scelta live-vs-mock la fa `CommerceBridge` (`packages/commerce-core/src/bridge.ts`):

```ts
private live(shop?: ShopContext): CommerceToolProvider | null {
  if (!shop?.shopUrl) return null;          // senza shopUrl → fallback mock
  if (shop.platform === 'shopify') return this.shopify;
  if (shop.platform === 'woocommerce') return this.woocommerce;
  return this.woocommerce;
}
```

Nella demo la sessione è creata **senza configurazione negozio**, quindi `live()` → `null` → mock. È il comportamento previsto per lo sviluppo offline.

## 5. Collegare un negozio reale (Shopify / WooCommerce)

Per far servire i prodotti dal tuo store, crea la sessione con i campi negozio (`POST /api/v1/sessions`):

| Campo | Valore |
|---|---|
| `product_type` | `"salesperson"` |
| `shop_url` | URL dello store (es. `https://mio-store.myshopify.com` o `https://miosito.com`) |
| `platform` | `"shopify"` o `"woocommerce"` |
| `currency` | es. `"EUR"` |
| `shop_credentials` | token/chiavi API del negozio |

Esempio Shopify:
```json
{
  "product_type": "salesperson",
  "shop_url": "https://mio-store.myshopify.com",
  "platform": "shopify",
  "currency": "EUR",
  "shop_credentials": { "shopify_admin_token": "shpat_..." }
}
```

Esempio WooCommerce:
```json
{
  "product_type": "salesperson",
  "shop_url": "https://miosito.com",
  "platform": "woocommerce",
  "currency": "EUR",
  "shop_credentials": {
    "woocommerce_consumer_key": "ck_...",
    "woocommerce_consumer_secret": "cs_..."
  }
}
```

A quel punto `CommerceBridge` usa l'adapter reale (`shopify-adapter.ts` / `woocommerce-adapter.ts`) e i prodotti, il carrello e il checkout vengono dal negozio.

## 6. API di riferimento

| Metodo | Path | Descrizione |
|---|---|---|
| `POST` | `/api/v1/sessions` | Crea sessione (auth: `Authorization: Bearer sk_live_...`) |
| `POST` | `/api/v1/sessions/:id/messages` | Invia messaggio testuale → `{ reply, audio_url }` |
| `POST` | `/api/v1/sessions/:id/audio` | Invia audio (STT → agent) |
| `GET` | `/api/v1/sessions/:id/audio/:audioId` | Serve audio TTS (no auth, id = capability) |
| `GET` | `/api/v1/sessions` | Elenca sessioni del tenant |
| `POST` | `/api/v1/sessions/:id/close` | Chiude la sessione |

## 7. Test end-to-end rapido (senza browser)

```bash
KEY="sk_live_..."
BASE="http://localhost:3000/api/v1"
SID=$(curl -s -X POST "$BASE/sessions" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"product_type":"persona","language":"it"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).session_id))")
curl -s -X POST "$BASE/sessions/$SID/messages" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" -d '{"text":"Ciao, presentati in una frase."}'
```

## 8. File principali

- `apps/saas-backend/src/routes/demo-chat.ts` — pagina demo
- `apps/saas-backend/src/routes/sessions.ts` — route sessioni
- `apps/saas-backend/src/providers/factory.ts` — wiring provider (LLM Qwen, commerce bridge)
- `apps/saas-backend/src/providers/qwen-llm.ts` — client LLM OpenAI-compatible
- `packages/commerce-core/src/bridge.ts` — scelta live-vs-mock
- `packages/mock-providers/src/commerce-provider.ts` — catalogo mock (`MOCK_PRODUCTS`)
