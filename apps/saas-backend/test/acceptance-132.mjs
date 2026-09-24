// Acceptance 132 — Phase 4: advanced pricing (revenue-based, hybrid, tiered,
// volume discounts). Standalone: imports the built cost-ledger package.

import assert from 'node:assert/strict';
import { PricingEngine } from '@ai-platform/cost-ledger';

const engine = new PricingEngine();

// per_unit: 5 units @ 100_000 = 500_000
{
  const q = engine.quote({ model: 'per_unit', unitPriceMicroUsd: 100_000 }, { units: 5 });
  assert.equal(q.model, 'per_unit');
  assert.equal(q.totalMicroUsd, 500_000);
  assert.equal(q.usageMicroUsd, 500_000);
  assert.equal(q.effectiveUnitPriceMicroUsd, 100_000);
}

// flat: base fee only, independent of usage
{
  const q = engine.quote({ model: 'flat', baseFeeMicroUsd: 2_000_000 }, { units: 100 });
  assert.equal(q.totalMicroUsd, 2_000_000);
  assert.equal(q.baseFeeMicroUsd, 2_000_000);
  assert.equal(q.usageMicroUsd, 0);
}

// revenue_based: 10% of 1_000_000 revenue = 100_000
{
  const q = engine.quote(
    { model: 'revenue_based', revenueSharePct: 0.1 },
    { units: 0, revenueMicroUsd: 1_000_000 },
  );
  assert.equal(q.totalMicroUsd, 100_000);
  assert.equal(q.revenueShareMicroUsd, 100_000);
}

// hybrid: base 1_000_000 + 10 units @ 10_000 (100_000) + 5% of 1_000_000 (50_000) = 1_150_000
{
  const q = engine.quote(
    { model: 'hybrid', baseFeeMicroUsd: 1_000_000, unitPriceMicroUsd: 10_000, revenueSharePct: 0.05 },
    { units: 10, revenueMicroUsd: 1_000_000 },
  );
  assert.equal(q.baseFeeMicroUsd, 1_000_000);
  assert.equal(q.usageMicroUsd, 100_000);
  assert.equal(q.revenueShareMicroUsd, 50_000);
  assert.equal(q.totalMicroUsd, 1_150_000);
}

// tiered: 2500 units across [0-1000 @100, 1000-5000 @80, 5000+ @60]
//   = 1000*100 + 1500*80 = 100_000 + 120_000 = 220_000
{
  const plan = {
    model: 'tiered',
    tiers: [
      { upTo: 1000, unitPriceMicroUsd: 100 },
      { upTo: 5000, unitPriceMicroUsd: 80 },
      { upTo: Infinity, unitPriceMicroUsd: 60 },
    ],
  };
  const q = engine.quote(plan, { units: 2500 });
  assert.equal(q.usageMicroUsd, 220_000);
  assert.equal(q.totalMicroUsd, 220_000);
}

// tiered crossing into the third tier: 7000 units
//   = 1000*100 + 4000*80 + 2000*60 = 100_000 + 320_000 + 120_000 = 540_000
{
  const plan = {
    model: 'tiered',
    tiers: [
      { upTo: 1000, unitPriceMicroUsd: 100 },
      { upTo: 5000, unitPriceMicroUsd: 80 },
      { upTo: Infinity, unitPriceMicroUsd: 60 },
    ],
  };
  const q = engine.quote(plan, { units: 7000 });
  assert.equal(q.totalMicroUsd, 540_000);
}

// volume discount: 20 units @ 100_000 = 2_000_000, 10% off (>=10 units) = 200_000
{
  const plan = {
    model: 'per_unit',
    unitPriceMicroUsd: 100_000,
    volumeDiscount: { minUnits: 10, discountPct: 0.1 },
  };
  const q = engine.quote(plan, { units: 20 });
  assert.equal(q.usageMicroUsd, 2_000_000);
  assert.equal(q.discountMicroUsd, 200_000);
  assert.equal(q.totalMicroUsd, 1_800_000);
  assert.equal(q.effectiveUnitPriceMicroUsd, 90_000);
}

// volume discount NOT applied below the threshold
{
  const plan = {
    model: 'per_unit',
    unitPriceMicroUsd: 100_000,
    volumeDiscount: { minUnits: 10, discountPct: 0.1 },
  };
  const q = engine.quote(plan, { units: 5 });
  assert.equal(q.discountMicroUsd, 0);
  assert.equal(q.totalMicroUsd, 500_000);
}

// volume discount never touches the base fee (hybrid)
{
  const plan = {
    model: 'hybrid',
    baseFeeMicroUsd: 1_000_000,
    unitPriceMicroUsd: 100_000,
    volumeDiscount: { minUnits: 10, discountPct: 0.5 },
  };
  const q = engine.quote(plan, { units: 20 });
  // usage 20*100_000 = 2_000_000, discount 50% of usage = 1_000_000, base stays 1_000_000
  assert.equal(q.baseFeeMicroUsd, 1_000_000);
  assert.equal(q.discountMicroUsd, 1_000_000);
  assert.equal(q.totalMicroUsd, 2_000_000);
}

// zero units: no charge, no effective unit price
{
  const q = engine.quote({ model: 'per_unit', unitPriceMicroUsd: 100_000 }, { units: 0 });
  assert.equal(q.totalMicroUsd, 0);
  assert.equal(q.effectiveUnitPriceMicroUsd, 0);
}

console.log('acceptance-132: all advanced-pricing checks passed');
