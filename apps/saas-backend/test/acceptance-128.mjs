// acceptance-128 — Phase 3: H200 self-hosted avatar provider + dynamic economics.
//
// Verifies that the SelfHostedAvatarProvider:
//   1. reports healthy + self-hosted capabilities,
//   2. prices each session by current utilization (dynamic economics),
//   3. gets cheaper per session as utilization rises toward capacity,
//   4. tracks active sessions across create/stop,
//   5. prices generate() by duration at the current utilization.

import assert from 'node:assert/strict';
import { SelfHostedAvatarProvider } from '@ai-platform/self-hosted';

const ctx = {
  tenantId: 'tenant-128',
  sessionId: 'session-128',
  requestId: 'req-128',
};

// H200: $6/hour fixed cost, 10 concurrent sessions.
const config = {
  gpuModel: 'H200',
  fixedCostPerHourMicroUsd: 6_000_000,
  capacity: 10,
};

async function main() {
  const provider = new SelfHostedAvatarProvider(config);

  // 1. Health + capabilities.
  const health = await provider.getHealth(ctx);
  assert.equal(health.status, 'healthy', 'provider should be healthy');

  const caps = await provider.getCapabilities();
  assert.equal(caps.maxConcurrentSessions, 10, 'capacity advertised');
  assert.equal(caps.features['self-hosted'], true, 'self-hosted feature flag');

  // 2. First session: 1 active of 10 -> cost = 6_000_000/60/1 * 5min = 500_000.
  const s1 = await provider.createSession(ctx, {});
  assert.equal(provider.activeSessionCount, 1, 'one active session');
  assert.equal(s1.cost.costMicroUsd, 500_000, 'first session cost at 10% utilization');
  assert.equal(s1.providerId, provider.id, 'provider id in result');

  // 3. Fill to capacity: the 10th session is priced at full utilization.
  let lastCost = 0;
  for (let i = 1; i < 10; i++) {
    const s = await provider.createSession(ctx, {});
    lastCost = s.cost.costMicroUsd;
  }
  assert.equal(provider.activeSessionCount, 10, 'at capacity');
  assert.equal(provider.utilization, 1, 'utilization is 1.0');
  assert.equal(lastCost, 50_000, 'session cost at 100% utilization (6_000_000/60/10*5)');

  // 4. Dynamic economics: higher utilization -> lower per-session cost.
  const econ = provider.getEconomics();
  const low = econ.effectiveCost(0.1);
  const high = econ.effectiveCost(1.0);
  assert.ok(
    low.effectiveCostPerSessionMicroUsd > high.effectiveCostPerSessionMicroUsd,
    'cost per session must decrease as utilization rises',
  );
  assert.equal(low.activeSessions, 1, '1 active session at 10%');
  assert.equal(high.activeSessions, 10, '10 active sessions at 100%');

  // 5. stopSession releases a slot.
  await provider.stopSession(ctx, s1.data.sessionId);
  assert.equal(provider.activeSessionCount, 9, 'slot released after stop');

  // 6. generate() prices by duration at the current utilization (9/10).
  const gen = await provider.generate(ctx, {}, 'x'.repeat(150)); // 150/15 = 10s
  assert.equal(gen.data.durationSec, 10, 'duration derived from script length');
  assert.ok(gen.cost.costMicroUsd > 0, 'generate cost is positive');

  // 7. shutdown resets the GPU.
  await provider.shutdown();
  assert.equal(provider.activeSessionCount, 0, 'no active sessions after shutdown');

  console.log('acceptance-128: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
