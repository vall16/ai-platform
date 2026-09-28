// Merchant dashboard routes — tenant-facing analytics (Phase 6).
//
//   GET /api/v1/merchant/analytics  — JSON analytics for the authenticated
//                                     tenant (requires a valid API key), ?days=
//   GET /merchant                   — self-contained HTML dashboard (no auth;
//                                     the page calls the auth-guarded API with a
//                                     user-supplied key stored in localStorage)

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MerchantAnalyticsService } from '../services/merchant-analytics.js';

type AuthGuard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export function registerMerchantRoutes(
  app: FastifyInstance,
  merchantAnalyticsService: MerchantAnalyticsService,
  authGuard: AuthGuard,
) {
  app.get('/api/v1/merchant/analytics', { preHandler: [authGuard] }, async (request, reply) => {
    const { days } = request.query as { days?: string };
    const parsed = days === undefined ? 30 : parseInt(days, 10);
    const window = Number.isFinite(parsed) ? parsed : 30;
    return reply.send(await merchantAnalyticsService.analytics(request.auth!.tenantId, window));
  });

  app.get('/merchant', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return MERCHANT_HTML;
  });
}

const MERCHANT_HTML = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dashboard</title>
<style>
  :root { --bg:#0f1115; --card:#181b22; --line:#262b36; --fg:#e6e9ef; --muted:#8b93a7; --ok:#3fb950; --warn:#d29922; --bad:#f85149; --accent:#58a6ff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  header { display:flex; align-items:center; gap:12px; padding:14px 20px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header .sub { color:var(--muted); font-size:12px; }
  .keybox { margin-left:auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .keybox input { background:#0b0d11; border:1px solid var(--line); color:var(--fg); padding:6px 10px; border-radius:6px; width:300px; font-size:12px; }
  .keybox button { background:var(--accent); color:#04121f; border:0; padding:7px 14px; border-radius:6px; font-weight:600; cursor:pointer; }
  .keybox select { background:#0b0d11; border:1px solid var(--line); color:var(--fg); padding:6px 8px; border-radius:6px; font-size:12px; }
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
  .empty { color:var(--muted); font-size:13px; }
  .foot { color:var(--muted); font-size:11px; text-align:center; padding:16px; }
</style>
</head>
<body>
<header>
  <h1>Dashboard</h1>
  <span class="sub">il tuo negozio</span>
  <div class="keybox">
    <select id="range">
      <option value="7">7 giorni</option>
      <option value="30" selected>30 giorni</option>
      <option value="90">90 giorni</option>
      <option value="0">Tutto</option>
    </select>
    <input id="key" type="password" placeholder="API key (sk_live_...)" autocomplete="off" />
    <button id="connect">Connetti</button>
  </div>
  <span id="status" class="status">in attesa di API key</span>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="label">Sessioni</div><div class="value" id="c-sessions">–</div><div class="hint" id="c-sessions-hint"></div></div>
    <div class="card"><div class="label">Costo</div><div class="value" id="c-cost">–</div><div class="hint">periodo</div></div>
    <div class="card"><div class="label">Ricavi</div><div class="value" id="c-revenue">–</div><div class="hint">sessioni</div></div>
    <div class="card"><div class="label">Margine</div><div class="value" id="c-margin">–</div><div class="hint" id="c-margin-hint"></div></div>
    <div class="card"><div class="label">Carrelli</div><div class="value" id="c-cart">–</div><div class="hint" id="c-cart-hint"></div></div>
  </div>

  <section>
    <h2>Sessioni per prodotto</h2>
    <div id="products" class="empty">n/d</div>
  </section>

  <section>
    <h2>Costo per risorsa</h2>
    <div id="resources" class="empty">n/d</div>
  </section>

  <section>
    <h2>Andamento giornaliero</h2>
    <div id="series" class="empty">n/d</div>
  </section>
</main>
<div class="foot" id="foot">Dashboard · auto-refresh 15s</div>

<script>
const $ = (id) => document.getElementById(id);
const usd = (micro) => '$' + (Number(micro || 0) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function key() { return localStorage.getItem('merchant_key') || ''; }
function setKey(k) { localStorage.setItem('merchant_key', k); }

function table(headers, rows) {
  if (!rows.length) return '<div class="empty">nessun dato</div>';
  const th = headers.map((h, i) => '<th class="' + (i > 0 ? 'num' : '') + '">' + h + '</th>').join('');
  const tr = rows.map((r) => '<tr>' + r.map((c, i) => '<td class="' + (i > 0 ? 'num' : '') + '">' + c + '</td>').join('') + '</tr>').join('');
  return '<table><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table>';
}

function render(o) {
  $('c-sessions').textContent = o.sessions.total;
  $('c-sessions-hint').textContent = o.sessions.active + ' attive';
  $('c-cost').textContent = usd(o.cost.total_micro_usd);
  $('c-revenue').textContent = usd(o.revenue.total_micro_usd);
  if (o.margin.gross_margin_pct == null) {
    $('c-margin').textContent = 'n/d';
    $('c-margin-hint').textContent = 'in attesa revenue';
  } else {
    $('c-margin').textContent = o.margin.gross_margin_pct.toFixed(1) + '%';
    $('c-margin-hint').textContent = 'lordo ' + usd(o.margin.gross_margin_micro_usd);
  }
  $('c-cart').textContent = o.commerce.cart_additions;
  $('c-cart-hint').textContent = o.commerce.orders_influenced + ' ordini · ' + usd(o.commerce.revenue_influenced_micro_usd);

  const prodRows = Object.entries(o.sessions.by_product_type).map(([k, v]) => [esc(k), v]);
  $('products').innerHTML = table(['prodotto', 'n'], prodRows);

  const resRows = Object.entries(o.cost.by_resource_type).map(([k, v]) => [esc(k), usd(v)]);
  $('resources').innerHTML = table(['risorsa', 'costo'], resRows);

  const seriesRows = o.series.map((s) => [esc(s.day), s.sessions, usd(s.cost_micro_usd), usd(s.revenue_micro_usd)]);
  $('series').innerHTML = table(['giorno', 'sessioni', 'costo', 'ricavi'], seriesRows);

  $('foot').textContent = 'Dashboard · aggiornato ' + new Date(o.generated_at).toLocaleTimeString('it-IT') + ' · auto-refresh 15s';
}

async function load() {
  const k = key();
  if (!k) { $('status').textContent = 'in attesa di API key'; $('status').className = 'status'; return; }
  try {
    const res = await fetch('/api/v1/merchant/analytics?days=' + $('range').value, { headers: { Authorization: 'Bearer ' + k } });
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
$('range').addEventListener('change', load);
$('key').value = key();
load();
setInterval(load, 15000);
</script>
</body>
</html>`;
