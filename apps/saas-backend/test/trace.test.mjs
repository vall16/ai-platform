// Unit tests for the W3C Trace Context helpers (src/observability/trace.ts).
//
// Run: node test/trace.test.mjs   (after `tsc -p tsconfig.chatbot.json`,
// which compiles trace.ts to dist-chatbot/observability/trace.js).

import assert from 'node:assert/strict';
import {
  newTraceContext,
  parseTraceparent,
  buildTraceparent,
  normalizeTraceId,
  continueTrace,
} from '../dist-chatbot/observability/trace.js';

// 1. parseTraceparent: valid header.
{
  const c = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  assert.ok(c, 'valid traceparent parses');
  assert.equal(c.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.equal(c.spanId, '00f067aa0ba902b7');
  assert.equal(c.sampled, true);
}

// 2. parseTraceparent: malformed headers are rejected.
for (const bad of [
  '',
  'garbage',
  '00-abc-00f067aa0ba902b7-01', // short trace id
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7', // missing flags
  'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', // reserved version
  '00-00000000000000000000000000000000-00f067aa0ba902b7-01', // all-zero trace id
  '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01', // all-zero parent id
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-0g', // bad flags
]) {
  assert.equal(parseTraceparent(bad), null, `should reject: ${JSON.stringify(bad)}`);
}

// 3. buildTraceparent round-trips through parseTraceparent.
{
  const ctx = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', sampled: true };
  const header = buildTraceparent(ctx);
  assert.equal(header, '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  const back = parseTraceparent(header);
  assert.deepEqual(back, ctx);
}

// 4. continueTrace: a valid inbound traceparent keeps the trace id, mints a new span.
{
  const inbound = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const ctx = continueTrace({ traceparent: inbound });
  assert.equal(ctx.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  assert.notEqual(ctx.spanId, '00f067aa0ba902b7', 'fresh span id for this hop');
  assert.equal(ctx.spanId.length, 16);
}

// 5. continueTrace: falls back to X-Trace-Id (a UUID becomes a 32-hex trace id).
{
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  const ctx = continueTrace({ 'x-trace-id': uuid });
  assert.equal(ctx.traceId, '123e4567e89b12d3a456426614174000');
}

// 6. continueTrace: no inbound headers -> a fresh, well-formed context.
{
  const ctx = continueTrace({});
  assert.equal(ctx.traceId.length, 32);
  assert.equal(ctx.spanId.length, 16);
  assert.equal(ctx.sampled, true);
}

// 7. normalizeTraceId: pads short input, truncates long, random when no hex.
{
  assert.equal(normalizeTraceId('123e4567-e89b-12d3-a456-426614174000'), '123e4567e89b12d3a456426614174000');
  assert.equal(normalizeTraceId('abc'), '00000000000000000000000000000abc');
  assert.equal(normalizeTraceId('!!!').length, 32);
}

// 8. Cross-service continuity: the traceparent the backend emits is continued
//    by the (Go) router with the SAME trace id. We simulate the router side by
//    feeding the emitted header back through continueTrace.
{
  const backend = newTraceContext();
  const emitted = buildTraceparent(backend);
  const routerSide = continueTrace({ traceparent: emitted });
  assert.equal(routerSide.traceId, backend.traceId, 'trace id preserved across the hop');
  assert.notEqual(routerSide.spanId, backend.spanId, 'router mints its own span');
}

console.log('OK — trace (W3C traceparent helpers): 8 checks passed');
