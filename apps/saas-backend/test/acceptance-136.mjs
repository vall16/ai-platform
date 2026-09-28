// Acceptance test 136 — Control Room v1 (Phase 6).
//
// Verifies the three Control Room v1 additions in the service aggregation:
//   1. routing distribution (routing_decision split by provider / resource),
//   2. hourly cost/revenue/margin series over the last 24h (merged from two
//      independent aggregates),
//   3. threshold alerting (cost rate, margin, load, provider health).
// Uses a fake pg pool that returns controlled rows per query.
//
// Run: node test/acceptance-136.mjs   (after the full `tsc` build -> dist/)

import assert from 'node:assert/strict';
import { ControlRoomService } from '../dist/services/control-room.js';

function makeFakePool(opts = {}) {
  const {
    routingByProvider = [],
    routingByResource = [],
    costSeries = [],
    revenueSeries = [],
    costLast5m = 0,
    revenueTotal = 0,
    costTotal = 0,
    active = 0,
  } = opts;
  return {
    async query(sql) {
      if (/GROUP BY status/i.test(sql)) return { rows: [{ status: 'active', n: active }, { status: 'completed', n: 3 }] };
      if (/GROUP BY product_type/i.test(sql)) return { rows: [{ product_type: 'persona', n: 5 }] };
      if (/date_trunc\('hour', created_at\)/i.test(sql)) return { rows: costSeries };
      if (/date_trunc\('hour', started_at\)/i.test(sql)) return { rows: revenueSeries };
      if (/SUM\(revenue_micro_usd\)/i.test(sql)) return { rows: [{ today: 0, total: revenueTotal }] };
      if (/SUM\(cart_additions\)/i.test(sql)) return { rows: [{ cart_additions: 0, orders_influenced: 0, revenue_influenced: 0 }] };
      if (/last_1m/i.test(sql)) return { rows: [{ last_1m: 0, last_5m: costLast5m, today: 0, total: costTotal }] };
      if (/FROM routing_decision/i.test(sql)) {
        return { rows: /selected_provider_id/i.test(sql) ? routingByProvider : routingByResource };
      }
      if (/GROUP BY resource_type/i.test(sql)) return { rows: [{ resource_type: 'llm', cost: costTotal }] };
      if (/FROM provider/i.test(sql)) return { rows: [] };
      if (/GROUP BY provider_id/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
    async end() {},
  };
}

let checks = 0;
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// 1. Routing distribution (routing_decision split by provider / resource).
{
  const svc = new ControlRoomService(makeFakePool({
    routingByProvider: [{ selected_provider_id: 'mock-llm', n: 7 }, { selected_provider_id: 'mock-tts', n: 3 }],
    routingByResource: [{ resource_type: 'llm', n: 8 }, { resource_type: 'tts', n: 2 }],
  }));
  const o = await svc.overview();
  eq(o.routing.total, 10, 'routing total 10');
  eq(o.routing.by_provider['mock-llm'], 7, 'provider llm 7');
  eq(o.routing.by_provider['mock-tts'], 3, 'provider tts 3');
  eq(o.routing.by_resource_type.llm, 8, 'resource llm 8');
  eq(o.routing.by_resource_type.tts, 2, 'resource tts 2');
}

// 2. Hourly cost/revenue/margin series (merged from two independent aggregates).
{
  const svc = new ControlRoomService(makeFakePool({
    costSeries: [{ hour: '2026-09-28 10:00', cost: 100 }, { hour: '2026-09-28 11:00', cost: 200 }],
    revenueSeries: [{ hour: '2026-09-28 11:00', revenue: 500 }, { hour: '2026-09-28 12:00', revenue: 300 }],
  }));
  const o = await svc.overview();
  eq(o.series.length, 3, '3 ore nella serie');
  const h10 = o.series.find((s) => s.hour === '2026-09-28 10:00');
  eq(h10.cost_micro_usd, 100, '10:00 cost 100');
  eq(h10.revenue_micro_usd, 0, '10:00 revenue 0');
  eq(h10.margin_micro_usd, -100, '10:00 margin -100');
  const h11 = o.series.find((s) => s.hour === '2026-09-28 11:00');
  eq(h11.cost_micro_usd, 200, '11:00 cost 200');
  eq(h11.revenue_micro_usd, 500, '11:00 revenue 500');
  eq(h11.margin_micro_usd, 300, '11:00 margin 300');
  const h12 = o.series.find((s) => s.hour === '2026-09-28 12:00');
  eq(h12.cost_micro_usd, 0, '12:00 cost 0');
  eq(h12.revenue_micro_usd, 300, '12:00 revenue 300');
  eq(h12.margin_micro_usd, 300, '12:00 margin 300');
}

// 3a. No alerts when everything is within limits.
{
  const svc = new ControlRoomService(makeFakePool({ costLast5m: 0, revenueTotal: 100000, costTotal: 10000, active: 2 }));
  const o = await svc.overview();
  eq(o.alerts.length, 0, 'nessun alert');
}

// 3b. High cost rate alert.
{
  const svc = new ControlRoomService(makeFakePool({ costLast5m: 2_000_000, revenueTotal: 100000, costTotal: 10000, active: 2 }));
  const o = await svc.overview();
  ok(o.alerts.some((a) => a.code === 'high_cost_rate' && a.severity === 'warn'), 'alert high_cost_rate');
}

// 3c. Low margin alert.
{
  const svc = new ControlRoomService(makeFakePool({ costLast5m: 0, revenueTotal: 100000, costTotal: 90000, active: 2 }));
  const o = await svc.overview();
  ok(o.alerts.some((a) => a.code === 'low_margin' && a.severity === 'warn'), 'alert low_margin');
}

// 3d. High load alert.
{
  const svc = new ControlRoomService(makeFakePool({ costLast5m: 0, revenueTotal: 100000, costTotal: 10000, active: 150 }));
  const o = await svc.overview();
  ok(o.alerts.some((a) => a.code === 'high_load' && a.severity === 'warn'), 'alert high_load');
}

// 3e. Provider unhealthy -> critical alert.
{
  const broken = { id: 'mock-tts-1', name: 'mock-tts', type: 'tts', getHealth: async () => { throw new Error('connection refused'); } };
  const svc = new ControlRoomService(makeFakePool({ costLast5m: 0, revenueTotal: 100000, costTotal: 10000, active: 2 }), [broken]);
  const o = await svc.overview();
  ok(o.alerts.some((a) => a.code === 'provider_unhealthy' && a.severity === 'critical'), 'alert provider_unhealthy');
}

console.log(`OK — acceptance 136 (Control Room v1, Phase 6): ${checks} checks passed`);
