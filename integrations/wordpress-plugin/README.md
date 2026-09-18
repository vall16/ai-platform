# AI Persona — WordPress Plugin

Widget conversazionale con avatar AI per siti WordPress. Supporta input testo e voce.

## Installazione

1. Copiare la cartella in `wp-content/plugins/ai-persona/`
2. Attivare il plugin da **Plugins → Installed Plugins**
3. Configurare in **Settings → AI Persona**:
   - **API Base URL** — URL del backend SaaS (es. `https://api.example.com`, senza slash finale)
   - API Key (dal Control Room)
   - Avatar ID e Voice ID (opzionali nel chatbot MVP)
   - Personalità / system prompt
   - Lingua e tema

## Uso

Aggiungere il shortcode in qualsiasi pagina o post:

```
[ai_persona]
```

Oppure trascinare il widget "AI Persona" in una sidebar (se il tema lo supporta).

## Struttura

```
ai-persona.php              ← plugin main (header, activation, hooks)
includes/
├── class-ai-persona.php    ← core: shortcode, asset loading, REST routes
├── class-ai-persona-settings.php  ← admin settings page
└── class-ai-persona-widget.php    ← WP_Widget registration
assets/
├── js/
│   ├── widget.js           ← frontend: chat, voice (Web Speech API), avatar video
│   └── admin.js            ← admin: API key validation
└── css/
    ├── widget.css          ← widget styles (dark/light theme)
    └── admin.css           ← admin panel styles
```

## Backend API attesa

Il widget comunica con il SaaS backend:

| Endpoint | Method | Scopo |
|----------|--------|-------|
| `/api/v1/sessions` | POST | Avvia sessione conversazione |
| `/api/v1/sessions/:id/messages` | POST | Invia messaggio testo (ritorna `reply` + `audio_url`) |
| `/api/v1/sessions/:id/audio/:audioId` | GET | Serve l'audio TTS (no auth, id UUID = capability) |
| `/api/v1/sessions/:id/avatar` | POST | Stream avatar video — **opzionale, non presente nel chatbot MVP** |

> Il widget usa `Authorization: Bearer <api_key>`. Il backend deve abilitare CORS per l'origine del sito WordPress (già fatto: `origin: true`, riflette l'header `Authorization`).
