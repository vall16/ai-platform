# AI Salesperson — Shopify App (Theme App Extension)

Widget "AI salesperson" per store Shopify: il cliente chiede prodotti a voce o testo,
l'AI cerca nel catalogo reale, guida all'acquisto e porta al checkout.

## Installazione

1. **Creare una custom app** in Shopify Admin → **Apps → Develop apps → Create an app**
   - Nome: `AI Salesperson`
   - Abilitare **Admin API access** → **Read products** (`read_products`)
   - Creare l'app e copiare l'**Admin API access token**
2. **Installare il theme app extension**:
   - Con `shopify theme app extension dev` (CLI) oppure caricando la cartella come
     extension nel tema (Shopify Admin → **Online Store → Themes → Customize →
     add the extension**).
3. **Aggiungere il block** "AI Salesperson Chat" a una sezione del tema
   (es. homepage, product page) e configurare:
   - **API Base URL** — URL del backend SaaS (es. `https://api.example.com`, senza slash finale)
   - **API Key** — dal Control Room
   - **Shop Name** — mostrato nell'header del widget (default: nome dello store)
   - **Currency** — codice ISO (default: valuta dello store)
   - **Shopify Admin API Access Token** — per il catalogo **live**
   - Personalità / system prompt, lingua, tema, voce

> **Demo mode:** se lasci vuoto l'access token, il widget gira con un catalogo di
> esempio (mock) — utile per provare il flusso senza configurare l'app.

## Come funziona

Il widget **non** parla direttamente con Shopify: invia il contesto dello store
(`shop_url`, `platform: shopify`, `currency`, `shop_credentials.access_token`) al
backend SaaS all'avvio della sessione. È il backend a chiamare l'Admin API di Shopify
(`search_products`, `get_product`, `add_to_cart`, `start_checkout`) e a restituire la
risposta testuale. Il checkout è un link al carrello/checkout dello store.

## Struttura

```
shopify.theme.extension.toml  ← manifest dell'extension (name, version)
blocks/
└── ai-salesperson-chat.liquid  ← block: schema + iniezione config + asset
assets/
├── ai-salesperson.js           ← frontend: chat, voice (Web Speech API), link checkout
└── ai-salesperson.css          ← widget styles (dark/light theme)
locales/
└── en.default.json             ← traduzioni del block
```

> `ai-salesperson.js` è lo **stesso widget condiviso** con il plugin WooCommerce
> (`integrations/woocommerce-plugin/`): mantenerlo identico nelle due cartelle.

## Backend API attesa

Il widget comunica con il SaaS backend:

| Endpoint | Method | Scopo |
|----------|--------|-------|
| `/api/v1/sessions` | POST | Avvia sessione (body con `product_type: salesperson` + campi commerce) |
| `/api/v1/sessions/:id/messages` | POST | Invia messaggio testo (ritorna `reply` + `audio_url`) |
| `/api/v1/sessions/:id/audio/:audioId` | GET | Serve l'audio TTS (no auth, id UUID = capability) |

> Il widget usa `Authorization: Bearer <api_key>`. Il backend deve abilitare CORS per
> l'origine dello store (già fatto: `origin: true`).
