// Control Room routes — internal ops dashboard (platform-wide, cross-tenant).
//
//   GET /api/v1/control-room/overview  — JSON overview (requires a valid API key)
//   GET /control-room                  — self-contained HTML dashboard (no auth;
//                                        the page calls the auth-guarded API with a
//                                        user-supplied key stored in localStorage)

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ControlRoomService } from '../services/control-room.js';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerControlRoomRoutes(
  app: FastifyInstance,
  controlRoomService: ControlRoomService,
  authGuard: AuthGuard,
) {
  app.get('/api/v1/control-room/overview', { preHandler: [authGuard] }, async (_request, reply) => {
    return reply.send(await controlRoomService.overview());
  });

  app.get('/control-room', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return CONTROL_ROOM_HTML;
  });
}

const CONTROL_ROOM_HTML = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Control Room</title>
<style>
  :root { --bg:#0f1115; --card:#181b22; --line:#262b36; --fg:#e6e9ef; --muted:#8b93a7; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --accent:#58a6ff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  header { display:flex; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header .sub { color:var(--muted); font-size:12px; }
  .keybox { margin-left:auto; display:flex; gap:8px; align-items:center; }
  .keybox input { background:#0b0d11; border:1px solid var(--line); color:var(--fg); padding:6px 10px; border-radius:6px; width:340px; font-size:12px; }
  .keybox button { background:var(--accent); color:#04121f; border:0; padding:7px 14px; border-radius:6px; font-weight:600; cursor:pointer; }
  .status { font-size:12px; color:var(--muted); }
  .status.err { color:var(--bad); }
  .status.ok { color:var(--ok); }
  main { padding:20px; max-width:1200px; margin:0 auto; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-bottom:20px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .card .label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  .card .value { font-size:26px; font-weight:600; margin-top:6px; }
  .card .hint { color:var(--muted); font-size:11px; margin-top:4px; }
  section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:16px; }
  section h2 { font-size:13px; margin:0 0 12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-weight:500; font-size:12px; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; border:1px solid var(--line); }
  .pill.active { color:var(--ok); border-color:var(--ok); }
  .pill.inactive, .pill.deprecated { color:var(--muted); }
  .pill.error { color:var(--bad); border-color:var(--bad); }
  .pill.healthy { color:var(--ok); border-color:var(--ok); }
  .pill.degraded { color:var(--warn); border-color:var(--warn); }
  .pill.unhealthy { color:var(--bad); border-color:var(--bad); }
  .empty { color:var(--muted); font-size:13px; }
  .note { color:var(--warn); font-size:12px; }
  .foot { color:var(--muted); font-size:11px; text-align:center; padding:16px; }
</style>
</head>
<body>
<header>
  <h1>Control Room</h1>
  <span class="sub">v0 · piattaforma</span>
  <div class="keybox">
    <input id="key" type="password" placeholder="API key (sk_live_...)" autocomplete="off" />
    <button id="connect">Connetti</button>
  </div>
  <span id="status" class="status">in attesa di API key</span>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="label">Sessioni attive</div><div class="value" id="c-active">–</div><div class="hint" id="c-active-hint"></div></div>
    <div class="card"><div class="label">Cost / min</div><div class="value" id="c-cost1m">–</div><div class="hint">ultimi 60s</div></div>
    <div class="card"><div class="label">Cost oggi</div><div class="value" id="c-costtoday">–</div><div class="hint">da mezzanotte</div></div>
    <div class="card"><div class="label">Cost totale</div><div class="value" id="c-costtotal">–</div><div class="hint">usage ledger</div></div>
    <div class="card"><div class="label">Margin</div><div class="value" id="c-margin">–</div><div class="hint" id="c-margin-hint"></div></div>
  </div>

  <section>
    <h2>Sessioni</h2>
    <div id="sessions" class="empty">n/d</div>
  </section>

  <section>
    <h2>Cost per risorsa</h2>
    <div id="resources" class="empty">n/d</div>
  </section>

  <section>
    <h2>Provider — attività (ultimi 5 min)</h2>
    <div id="usage" class="empty">n/d</div>
  </section>

  <section>
    <h2>Provider — health</h2>
    <div id="health" class="empty">n/d</div>
  </section>

  <section>
    <h2>Provider — catalogo registrato</h2>
    <div id="providers" class="empty">n/d</div>
  </section>
</main>
<div class="foot" id="foot">Control Room v0 · auto-refresh 10s</div>

<script>
const $ = (id) => document.getElementById(id);
const usd = (micro) => '$' + (Number(micro || 0) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function key() { return localStorage.getItem('cr_key') || ''; }
function setKey(k) { localStorage.setItem('cr_key', k); }

function table(headers, rows) {
  if (!rows.length) return '<div class="empty">nessun dato</div>';
  const th = headers.map((h, i) => '<th class="' + (i > 0 ? 'num' : '') + '">' + h + '</th>').join('');
  const tr = rows.map((r) => '<tr>' + r.map((c, i) => '<td class="' + (i > 0 ? 'num' : '') + '">' + c + '</td>').join('') + '</tr>').join('');
  return '<table><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table>';
}

function healthTable(rows) {
  if (!rows.length) return '<div class="empty">nessun provider cablato</div>';
  const th = '<th>provider</th><th>stato</th><th class="num">latency</th><th>detail</th>';
  const tr = rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td class="num">' + r[2] + '</td><td>' + r[3] + '</td></tr>').join('');
  return '<table><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table>';
}

function render(o) {
  $('c-active').textContent = o.sessions.active;
  $('c-active-hint').textContent = 'totale ' + o.sessions.total;
  $('c-cost1m').textContent = usd(o.cost.last_1m_micro_usd);
  $('c-costtoday').textContent = usd(o.cost.today_micro_usd);
  $('c-costtotal').textContent = usd(o.cost.total_micro_usd);
  if (o.margin.available) {
    $('c-margin').textContent = o.margin.gross_margin_pct == null ? 'n/d' : o.margin.gross_margin_pct.toFixed(1) + '%';
    $('c-margin-hint').textContent = 'rev ' + usd(o.margin.revenue_micro_usd) + ' · cost ' + usd(o.margin.cost_micro_usd);
  } else {
    $('c-margin').textContent = 'n/d';
    $('c-margin-hint').textContent = 'in attesa revenue';
  }

  const statusRows = Object.entries(o.sessions.by_status).map(([k, v]) => [esc(k), v]);
  const prodRows = Object.entries(o.sessions.by_product_type).map(([k, v]) => [esc(k), v]);
  $('sessions').innerHTML =
    '<div style="margin-bottom:10px;color:var(--muted);font-size:12px">per stato</div>' + table(['stato', 'n'], statusRows) +
    '<div style="margin:14px 0 10px;color:var(--muted);font-size:12px">per prodotto</div>' + table(['prodotto', 'n'], prodRows);

  const resRows = Object.entries(o.cost.by_resource_type).map(([k, v]) => [esc(k), usd(v)]);
  $('resources').innerHTML = table(['risorsa', 'cost totale'], resRows);

  const usageRows = o.provider_usage.map((u) => [esc(u.provider_id), u.total_requests, u.requests_last_5m, usd(u.cost_last_5m_micro_usd), new Date(u.last_seen_at).toLocaleTimeString('it-IT')]);
  $('usage').innerHTML = table(['provider', 'req totali', 'req 5m', 'cost 5m', 'ultima'], usageRows);

  const healthRows = (o.provider_health || []).map((h) => [
    esc(h.name) + ' <span style="color:var(--muted)">(' + esc(h.type) + ')</span>',
    '<span class="pill ' + esc(h.status) + '">' + esc(h.status) + '</span>',
    h.latency_ms + ' ms',
    h.detail ? esc(h.detail) : '',
  ]);
  $('health').innerHTML = healthTable(healthRows);

  const provRows = o.providers.map((p) => ['<span class="pill ' + esc(p.status) + '">' + esc(p.status) + '</span> ' + esc(p.name) + ' <span style="color:var(--muted)">(' + esc(p.type) + ')</span>', '']);
  $('providers').innerHTML = o.providers.length ? table(['provider', ''], provRows) : '<div class="empty">nessun provider registrato (i mock usano id stringa in usage_ledger)</div>';

  $('foot').textContent = 'Control Room v0 · aggiornato ' + new Date(o.generated_at).toLocaleTimeString('it-IT') + ' · auto-refresh 10s';
}

async function load() {
  const k = key();
  if (!k) { $('status').textContent = 'in attesa di API key'; $('status').className = 'status'; return; }
  try {
    const res = await fetch('/api/v1/control-room/overview', { headers: { Authorization: 'Bearer ' + k } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    render(await res.json());
    $('status').textContent = 'ok';
    $('status').className = 'status ok';
  } catch (e) {
    $('status').textContent = 'errore: ' + e.message;
    $('status').className = 'status err';
  }
}

$('connect').addEventListener('click', () => { setKey($('key').value.trim()); load(); });
$('key').value = key();
load();
setInterval(load, 10000);
</script>
</body>
</html>`;
