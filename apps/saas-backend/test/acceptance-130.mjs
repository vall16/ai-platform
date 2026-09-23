// acceptance-130 — Phase 3: profitability (cost allocation + routing objective).
//
// Verifies the cost-ledger economics primitives that drive profitability:
//   1. CostAllocator.trueRealizedCostPerMin amortizes a fixed cost over usage,
//   2. CostAllocator.allocate spreads a fixed cost across sessions by duration,
//   3. selectProvider(MINIMIZE_MARGINAL_COST) picks the cheapest provider,
//   4. selectProvider(MAXIMIZE_GROSS_MARGIN) picks the most profitable provider,
//   5. a self-hosted GPU at full utilization beats a cloud provider on margin.

import assert from 'node:assert/strict';
import {
  CostAllocator,
  SelfHostedEconomics,
  selectProvider,
} from '@ai-platform/cost-ledger';

async function main() {
  // 1. True realized cost per minute.
  const allocator = new CostAllocator();
  assert.equal(
    allocator.trueRealizedCostPerMin(6_000_000, 60),
    100_000,
    '$6/hour over 60min = 100_000/min',
  );
  assert.equal(allocator.trueRealizedCostPerMin(6_000_000, 0), 0, 'zero minutes -> zero');

  // 2. Allocate a fixed cost proportionally across sessions by duration.
  const alloc = allocator.allocate(600_000, [
    { id: 's1', minutes: 30 },
    { id: 's2', minutes: 30 },
    { id: 's3', minutes: 60 },
  ]);
  assert.equal(alloc.get('s1'), 150_000, 's1 = 600_000 * 30/120');
  assert.equal(alloc.get('s2'), 150_000, 's2 = 600_000 * 30/120');
  assert.equal(alloc.get('s3'), 300_000, 's3 = 600_000 * 60/120');
  const total = [...alloc.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 600_000, 'allocation sums to the fixed cost');

  // 3. Routing objective: MINIMIZE_MARGINAL_COST.
  const candidates = [
    { providerId: 'cloud-a', marginalCostMicroUsd: 200_000, revenueMicroUsd: 500_000 },
    { providerId: 'self-hosted', marginalCostMicroUsd: 50_000, revenueMicroUsd: 500_000 },
    { providerId: 'cloud-b', marginalCostMicroUsd: 150_000, revenueMicroUsd: 500_000 },
  ];
  const minCost = selectProvider('MINIMIZE_MARGINAL_COST', candidates);
  assert.equal(minCost.providerId, 'self-hosted', 'lowest marginal cost wins');

  // 4. Routing objective: MAXIMIZE_GROSS_MARGIN.
  const marginCandidates = [
    { providerId: 'cloud-a', marginalCostMicroUsd: 200_000, revenueMicroUsd: 500_000 }, // margin 300_000
    { providerId: 'self-hosted', marginalCostMicroUsd: 50_000, revenueMicroUsd: 400_000 }, // margin 350_000
    { providerId: 'cloud-b', marginalCostMicroUsd: 150_000, revenueMicroUsd: 500_000 }, // margin 350_000
  ];
  const maxMargin = selectProvider('MAXIMIZE_GROSS_MARGIN', marginCandidates);
  assert.equal(maxMargin.providerId, 'self-hosted', 'highest gross margin wins (tie keeps first)');

  // 5. Empty candidate list -> null.
  assert.equal(selectProvider('MINIMIZE_MARGINAL_COST', []), null, 'no candidates -> null');

  // 6. Profitability: self-hosted at full utilization beats cloud on margin.
  const econ = new SelfHostedEconomics({
    gpuModel: 'H200',
    fixedCostPerHourMicroUsd: 6_000_000,
    capacity: 10,
  });
  const perSessionAtFull = econ.effectiveCost(1.0).effectiveCostPerSessionMicroUsd; // 50_000
  const revenue = 500_000;
  const selfMargin = revenue - perSessionAtFull; // 450_000
  const cloudMargin = revenue - 200_000; // 300_000
  assert.ok(selfMargin > cloudMargin, 'self-hosted at full utilization is more profitable');

  console.log('acceptance-130: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
