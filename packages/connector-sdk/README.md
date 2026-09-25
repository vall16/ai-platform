# @ai-platform/connector-sdk

Client riutilizzabile, **transport-agnostic**, per il backend SaaS della AI Platform. È il layer condiviso da tutti i connector front-end — **Webflow, Wix, Squarespace, siti custom, app mobile** — in modo che ogni integrazione parli con la piattaforma con la stessa logica, già testata.

Estrae in un package la logica che oggi vive dentro il widget WordPress (`integrations/wordpress-plugin/assets/js/widget.js`): avvio sessione, invio messaggio, input vocale, chiusura, audio TTS.

## Perché un SDK

- **Un solo punto di verità** per il contratto client↔backend: se l'API cambia, si aggiorna qui, non in ogni connector.
- **Portabile**: gira in browser (Webflow/Wix/Squarespace/custom), mobile e Node 20+ — usa solo web globals (`fetch`, `URL`, `AbortController`).
- **Mock sempre disponibili**: `createMockBackend()` permette di sviluppare e testare un connector completamente offline, senza API key né rete (stessa regola del resto della piattaforma).
- **Errori tipizzati**: i codici di errore del backend (`quota_exhausted`, `session_not_found`, …) diventano classi di errore su cui fare `instanceof`.

## Installazione (nel monorepo)

```bash
npm install            # al root: linka il workspace
npm run build -w @ai-platform/connector-sdk
```

## Uso

```ts
import { ConnectorClient, QuotaExhaustedError } from '@ai-platform/connector-sdk';

const connector = new ConnectorClient({
  apiBase: 'https://api.example.com',
  apiKey: 'sk_live_...',
  productType: 'persona',
  // persona
  language: 'it',
  personality: 'friendly',
  siteUrl: window.location.origin,
  // salesperson (per AI Salesperson)
  // shopName: 'My Shop', shopUrl: 'https://myshop.myshopify.com',
  // platform: 'shopify', currency: 'EUR',
});

try {
  await connector.startSession();
  const { reply, audio_url } = await connector.sendMessage('Ciao!');
  // if (audio_url) play(audio_url);
  // const { transcript } = await connector.sendAudio(bytes, 'audio/webm');
  await connector.closeSession('completed');
} catch (err) {
  if (err instanceof QuotaExhaustedError) {
    // quota prepagata esaurita → mostra un messaggio al visitatore
  }
}
```

### Sviluppo offline (mock)

```ts
import { ConnectorClient, createMockBackend } from '@ai-platform/connector-sdk';

const connector = new ConnectorClient({
  apiBase: 'http://localhost',
  apiKey: 'dev',
  productType: 'persona',
  transport: createMockBackend(), // niente rete, niente API key
});
await connector.startSession();
console.log((await connector.sendMessage('Ciao')).reply); // "Mock reply to: Ciao"
```

## API

| Metodo | Endpoint | Note |
|---|---|---|
| `startSession()` | `POST /api/v1/sessions` | ricorda l'id della sessione corrente |
| `sendMessage(text)` | `POST /api/v1/sessions/:id/messages` | ritorna `{ reply, audio_url? }` |
| `sendAudio(bytes, mimeType?)` | `POST /api/v1/sessions/:id/audio` | input vocale (STT→agent), ritorna `{ reply, transcript, audio_url? }` |
| `closeSession(status?)` | `POST /api/v1/sessions/:id/close` | `completed`/`abandoned`/`error`, azzera la sessione corrente |
| `getSession(id?)` | `GET /api/v1/sessions/:id` | default: sessione corrente |
| `listSessions({status?, limit?})` | `GET /api/v1/sessions` | |
| `countActiveSessions()` | `GET /api/v1/sessions/active/count` | |
| `audioUrl(sessionId, audioId)` | — | costruisce l'URL assoluto del TTS (da riprodurre con `<audio>`/`AVPlayer`) |
| `health()` | `GET /api/v1/health` | senza auth |

### Config

`apiBase`, `apiKey`, `productType` sono obbligatori. Opzionali: campi persona/salesperson (sopra), `metadata`, `fetch` (fetch custom), `timeoutMs` (default 30000), `transport` (inietta un transport custom — avanzato/test).

### Errori

`ConnectorError` (base, con `status` e `code`) → `AuthError` (401), `QuotaExhaustedError` (402), `SessionNotFoundError` (404), `SessionNotActiveError` (409), `SttNotConfiguredError` (501), `NetworkError` (timeout/connessione).

## Trasporto

- `FetchTransport` — default, usa `fetch` globale + timeout.
- `MockTransport` — in-memory, guidato da un handler.
- `createMockBackend()` — simula il backend (store sessioni in memoria, echo messaggi, transcript fissa).

## Test

```bash
npm run test -w @ai-platform/connector-sdk
```

Test standalone (`node:assert`, no framework): client su mock backend, mapping errori, `FetchTransport` (header, body JSON/raw, timeout, failure), validazione config.
