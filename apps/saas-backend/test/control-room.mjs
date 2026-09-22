// Control Room gross-margin test — verifies revenue (session) vs cost (usage_ledger)
// aggregation and the margin math, using a fake pg pool (no real Postgres).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlRoomService } from '../dist/services/control-room.js';

function makeFakePool({ revenueToday = 200000, revenueTotal = 500000, costToday = 100000, costTotal = 300000 } = {}) {
  return {
    async query(sql) {
      if (/SUM\(revenue_micro_usd\)/.test(sql)) return { rows: [{ today: revenueToday, total: revenueTotal }] };
      if (/last_1m/.test(sql)) return { rows: [{ last_1m: 0, last_5m: 0, today: costToday, total: costTotal }] };
      if (/GROUP BY resource_type/.test(sql)) return { rows: [{ resource_type: 'llm', cost: costTotal }] };
      if (/GROUP BY provider_id/.test(sql)) return { rows: [] };
      if (/FROM provider/.test(sql)) return { rows: [] };
      if (/GROUP BY status/.test(sql)) return { rows: [{ status: 'active', n: 2 }, { status: 'completed', n: 3 }] };
      if (/GROUP BY product_type/.test(sql)) return { rows: [{ product_type: 'persona', n: 5 }] };
      return { rows: [] };
    },
    async end() {},
  };
}

test('control room computes gross margin from revenue and cost', async () => {
  const svc = new ControlRoomService(makeFakePool());
  const o = await svc.overview();

  assert.equal(o.margin.available, true);
  assert.equal(o.margin.revenue_micro_usd, 500000);
  assert.equal(o.margin.cost_micro_usd, 300000);
  assert.equal(o.margin.gross_margin_micro_usd, 200000);
  assert.ok(Math.abs(o.margin.gross_margin_pct - 40) < 1e-9);
  assert.equal(o.sessions.total, 5);
  assert.equal(o.sessions.active, 2);
});

test('control room margin pct is null when revenue is zero', async () => {
  const svc = new ControlRoomService(makeFakePool({ revenueToday: 0, revenueTotal: 0 }));
  const o = await svc.overview();

  assert.equal(o.margin.available, true);
  assert.equal(o.margin.gross_margin_pct, null);
  assert.equal(o.margin.gross_margin_micro_usd, -300000);
});
