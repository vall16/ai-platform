// Demo chat page — standalone widget demo served by the backend.
// Simulates the AI Persona / AI Salesperson chat widget without needing a CMS.

import type { FastifyInstance } from 'fastify';

const DEMO_HTML = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AI Chat Demo</title>
<style>
  :root { --bg:#0f1115; --card:#181b22; --line:#262b36; --fg:#e6e9ef; --muted:#8b93a7; --accent:#58a6ff; --user:#1c2536; --bot:#21262d; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; display:flex; flex-direction:column; height:100vh; }
  header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header .sub { color:var(--muted); font-size:12px; }
  .keybox { margin-left:auto; display:flex; gap:8px; align-items:center; }
  .keybox input { background:#0b0d11; border:1px solid var(--line); color:var(--fg); padding:6px 10px; border-radius:6px; width:320px; font-size:12px; }
  .keybox button { background:var(--accent); color:#04121f; border:0; padding:7px 14px; border-radius:6px; font-weight:600; cursor:pointer; }
  .keybox select { background:#0b0d11; border:1px solid var(--line); color:var(--fg); padding:6px 8px; border-radius:6px; }
  .status { font-size:12px; color:var(--muted); }
  .status.ok { color:#3fb950; }
  .status.err { color:#f85149; }
  main { flex:1; display:flex; overflow:hidden; }
  .chat { flex:1; display:flex; flex-direction:column; max-width:720px; margin:0 auto; width:100%; padding:16px; }
  .messages { flex:1; overflow-y:auto; padding:12px 0; display:flex; flex-direction:column; gap:10px; }
  .msg { max-width:80%; padding:10px 14px; border-radius:12px; font-size:14px; line-height:1.4; white-space:pre-wrap; word-break:break-word; }
  .msg.user { align-self:flex-end; background:var(--user); border:1px solid var(--line); border-bottom-right-radius:4px; }
  .msg.assistant { align-self:flex-start; background:var(--bot); border:1px solid var(--line); border-bottom-left-radius:4px; }
  .msg.assistant.typing { display:flex; gap:4px; align-items:center; padding:14px 18px; }
  .msg.assistant.typing span { width:7px; height:7px; background:var(--muted); border-radius:50%; animation:bounce 1.2s infinite; }
  .msg.assistant.typing span:nth-child(2) { animation-delay:.2s; }
  .msg.assistant.typing span:nth-child(3) { animation-delay:.4s; }
  @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
  .input-area { display:flex; gap:8px; padding-top:12px; border-top:1px solid var(--line); }
  .input-area input { flex:1; background:#0b0d11; border:1px solid var(--line); color:var(--fg); padding:10px 14px; border-radius:8px; font-size:14px; }
  .input-area button { background:var(--accent); color:#04121f; border:0; padding:10px 18px; border-radius:8px; font-weight:600; cursor:pointer; font-size:14px; }
  .input-area button:disabled { opacity:.5; cursor:not-allowed; }
  .session-info { font-size:11px; color:var(--muted); padding:4px 0 0; }
</style>
</head>
<body>
<header>
  <h1>AI Chat Demo</h1>
  <span class="sub">Persona / Salesperson</span>
  <div class="keybox">
    <select id="product">
      <option value="persona">AI Persona</option>
      <option value="salesperson" selected>AI Salesperson</option>
    </select>
    <input id="key" type="password" placeholder="API key (sk_live_...)" autocomplete="off" />
    <button id="connect">Connetti</button>
  </div>
  <span id="status" class="status">in attesa</span>
</header>
<main>
  <div class="chat">
    <div class="messages" id="messages"></div>
    <div class="input-area">
      <input id="input" type="text" placeholder="Scrivi un messaggio..." disabled />
      <button id="send" disabled>Invia</button>
    </div>
    <div class="session-info" id="session-info"></div>
  </div>
</main>
<script>
const $ = (id) => document.getElementById(id);
const API = window.location.origin;
let sessionId = null;

function key() { return localStorage.getItem('demo_key') || ''; }
function setKey(k) { localStorage.setItem('demo_key', k); }

function append(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'msg assistant typing';
  div.id = 'typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  $('messages').appendChild(div);
  $('messages').scrollTop = $('messages').scrollHeight;
}
function hideTyping() { document.getElementById('typing')?.remove(); }

async function startSession() {
  const product = $('product').value;
  const res = await fetch(API + '/api/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key() },
    body: JSON.stringify({
      product_type: product,
      language: 'it',
      shop_name: 'Demo Store',
      platform: 'demo',
    }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  sessionId = data.session_id;
  $('input').disabled = false;
  $('send').disabled = false;
  $('status').textContent = 'sessione ' + sessionId.slice(0, 8) + '…';
  $('status').className = 'status ok';
  $('session-info').textContent = 'Session: ' + sessionId + ' · ' + product;
  append('assistant', product === 'persona'
    ? 'Ciao! Sono la tua AI Persona. Come posso aiutarti oggi?'
    : 'Ciao! Sono il tuo assistente di vendita virtuale. Posso aiutarti a trovare il prodotto perfetto. Cosa stai cercando?');
}

async function send() {
  const text = $('input').value.trim();
  if (!text || !sessionId) return;
  $('input').value = '';
  append('user', text);
  showTyping();
  try {
    const res = await fetch(API + '/api/v1/sessions/' + sessionId + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key() },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    hideTyping();
    append('assistant', data.reply);
  } catch (e) {
    hideTyping();
    append('assistant', '⚠️ Errore: ' + e.message);
  }
}

$('connect').addEventListener('click', async () => {
  setKey($('key').value.trim());
  $('messages').innerHTML = '';
  sessionId = null;
  $('input').disabled = true;
  $('send').disabled = true;
  $('status').textContent = 'connessione...';
  $('status').className = 'status';
  try {
    await startSession();
  } catch (e) {
    $('status').textContent = 'errore: ' + e.message;
    $('status').className = 'status err';
  }
});
$('send').addEventListener('click', send);
$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
$('key').value = key();
if (key()) $('connect').click();
</script>
</body>
</html>`;

export function registerDemoChatRoute(app: FastifyInstance) {
  app.get('/demo-chat', async (_request, reply) => {
    reply.type('text/html').send(DEMO_HTML);
  });
}
