# AI Persona — WordPress Plugin

Widget conversazionale con avatar AI per siti WordPress. Supporta input testo e voce.

## Installazione

1. Copiare la cartella in `wp-content/plugins/ai-persona/`
2. Attivare il plugin da **Plugins → Installed Plugins**
3. Configurare in **Settings → AI Persona**:
   - API Key (dal Control Room)
   - Avatar ID e Voice ID
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
| `/api/v1/sessions/:id/messages` | POST | Invia messaggio testo |
| `/api/v1/sessions/:id/avatar` | POST | Connette stream avatar video |
