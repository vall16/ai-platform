// @ai-platform/connector-sdk — public API.
//
// A transport-agnostic client for the AI Platform SaaS backend, shared by all
// front-end connectors (Webflow, Wix, Squarespace, custom sites, mobile).

export { ConnectorClient } from './client.js';

export {
  FetchTransport,
  MockTransport,
  createMockBackend,
  type Transport,
  type TransportRequest,
  type TransportResponse,
  type MockResponse,
  type MockHandler,
  type FetchTransportOptions,
} from './transport.js';

export {
  ConnectorError,
  AuthError,
  QuotaExhaustedError,
  SessionNotFoundError,
  SessionNotActiveError,
  SttNotConfiguredError,
  NetworkError,
} from './errors.js';

export type {
  ConnectorConfig,
  Session,
  SessionStatus,
  ProductType,
  MessageResult,
  AudioResult,
  HealthResult,
  FetchLike,
} from './types.js';
