// W3C Trace Context helpers (dependency-free). Mirrors the Go router's
// internal/trace package so a single trace id can flow across services:
// the backend continues an inbound trace (or starts one) and emits it back on
// the response as both X-Trace-Id and the standard `traceparent` header.

import { randomBytes } from 'node:crypto';

export interface TraceContext {
  /** 32 lowercase hex chars. */
  traceId: string;
  /** 16 lowercase hex chars. */
  spanId: string;
  sampled: boolean;
}

const HEX = /^[0-9a-f]+$/;

function randomHex(nBytes: number): string {
  return randomBytes(nBytes).toString('hex');
}

/** A fresh, sampled trace context. */
export function newTraceContext(): TraceContext {
  return { traceId: randomHex(16), spanId: randomHex(8), sampled: true };
}

/**
 * Parse a W3C `traceparent` header:
 * `00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>`.
 * Returns null when the header is malformed.
 */
export function parseTraceparent(header: string): TraceContext | null {
  const parts = header.split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, parentSpanId, flags] = parts;
  if (version.length !== 2 || !HEX.test(version) || version === 'ff') return null;
  if (traceId.length !== 32 || !HEX.test(traceId) || traceId === '0'.repeat(32)) return null;
  if (parentSpanId.length !== 16 || !HEX.test(parentSpanId) || parentSpanId === '0'.repeat(16)) return null;
  if (flags.length !== 2 || !HEX.test(flags)) return null;
  return {
    traceId: traceId.toLowerCase(),
    spanId: parentSpanId.toLowerCase(),
    sampled: flags.includes('1'),
  };
}

/** Render a context as a W3C `traceparent` header. */
export function buildTraceparent(ctx: TraceContext): string {
  const flags = ctx.sampled ? '01' : '00';
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`;
}

/**
 * Turn an arbitrary correlation id (e.g. a UUID) into a valid 32-hex W3C trace
 * id: keep the hex chars, truncate to 32, left-pad with zeros. A UUID with its
 * dashes stripped is already 32 hex. Falls back to a random id when no hex
 * characters remain.
 */
export function normalizeTraceId(s: string): string {
  const hex = s.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length === 0) return randomHex(16);
  return hex.slice(0, 32).padStart(32, '0');
}

/**
 * Continue an inbound trace (minting a fresh span id for this hop) or start a
 * new one. Precedence: valid `traceparent` > `x-trace-id` > new trace.
 * Accepts Node's IncomingHttpHeaders (values may be string | string[]).
 */
export function continueTrace(
  headers: Record<string, string | string[] | undefined>,
): TraceContext {
  const get = (name: string): string | undefined => {
    const v = headers[name.toLowerCase()];
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const tp = get('traceparent');
  if (tp) {
    const parsed = parseTraceparent(tp);
    if (parsed) {
      return { traceId: parsed.traceId, spanId: randomHex(8), sampled: parsed.sampled };
    }
  }

  const xTraceId = get('x-trace-id');
  if (xTraceId) {
    return { traceId: normalizeTraceId(xTraceId), spanId: randomHex(8), sampled: true };
  }

  return newTraceContext();
}
