# AI Salesperson — WooCommerce Plugin

Widget "AI salesperson" per store WooCommerce: il cliente chiede prodotti a voce o testo, l'AI cerca nel catalogo reale, guida all'acquisto e porta al checkout.

## Installazione

1. Copiare la cartella in `wp-content/plugins/ai-salesperson/`
2. Attivare il plugin da **Plugins → Installed Plugins**
3. Configurare in **Settings → AI Salesperson**:
   - **API Base URL** — URL del backend SaaS (es. `https://api.example.com`, senza slash finale)
   - **API Key** — dal Control Room
   - **Shop Name** — mostrato nell'header del widget (default: titolo del sito)
   - **Currency** — codice ISO (default: valuta WooCommerce)
   - **WooCommerce REST API — Consumer Key / Secret** — per il catalogo **live**
   - Personalità / system prompt, lingua, tema, voce

### Chiavi WooCommerce REST API (per il catalogo live)

Creare una chiave in **WooCommerce → Settings → Advanced → REST API → Add key** con permesso **Read**.
Incollare `Consumer Key` e `Consumer Secret` nelle impostazioni del plugin.

> **Demo mode:** se lasci entrambe le chiavi vuote, il widget gira con un catalogo di esempio (mock) — utile per provare il flusso senza configurare l'API.

## Uso

Aggiungere il shortcode in qualsiasi pagina o post:

```
[ai_salesperson]
```

Oppure trascinare il widget "AI Salesperson" in una sidebar (se il tema lo supporta).

## Come funziona

Il widget **non** parla direttamente con WooCommerce: invia il contesto dello store
(`shop_url`, `platform: woocommerce`, `currency`, `shop_credentials`) al backend SaaS
all'avvio della sessione. È il backend a chiamare l'API REST di WooCommerce
(`search_products`, `get_product`, `add_to_cart`, `start_checkout`) e a restituire la
risposta testuale. Il checkout è un link al carrello/checkout dello store.

## Struttura

```
ai-salesperson.php              ← plugin main (header, activation, hooks)
includes/
├── class-ai-salesperson.php    ← core: shortcode, asset loading, REST routes, live/mock switch
├── class-ai-salesperson-settings.php  ← admin settings page
└── class-ai-salesperson-widget.php    ← WP_Widget registration
assets/
├── js/
│   ├── ai-salesperson.js       ← frontend: chat, voice (Web Speech API), link checkout
│   └── admin.js                ← admin: API key validation
└── css/
    ├── widget.css              ← widget styles (dark/light theme)
    └── admin.css               ← admin panel styles
```

> `ai-salesperson.js` è lo **stesso widget condiviso** con l'app Shopify
> (`integrations/shopify-app/`): mantenerlo identico nelle due cartelle.

## Backend API attesa

Il widget comunica con il SaaS backend:

| Endpoint | Method | Scopo |
|----------|--------|-------|
| `/api/v1/sessions` | POST | Avvia sessione (body con `product_type: salesperson` + campi commerce) |
| `/api/v1/sessions/:id/messages` | POST | Invia messaggio testo (ritorna `reply` + `audio_url`) |
| `/api/v1/sessions/:id/audio/:audioId` | GET | Serve l'audio TTS (no auth, id UUID = capability) |

> Il widget usa `Authorization: Bearer <api_key>`. Il backend deve abilitare CORS per
> l'origine dello store (già fatto: `origin: true`).
