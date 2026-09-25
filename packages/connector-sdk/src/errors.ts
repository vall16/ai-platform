// @ai-platform/connector-sdk — typed errors.
//
// The backend signals failures with an HTTP status plus a JSON `{ error: <code> }`
// body (see apps/saas-backend/src/routes/sessions.ts). The SDK maps those to a small
// hierarchy of typed errors so connectors can branch on the failure kind without
// string-matching.

/** Base class for all connector errors. */
export class ConnectorError extends Error {
  /** HTTP status code, or 0 for network-level failures. */
  readonly status: number;
  /** Machine-readable code from the backend body (e.g. "quota_exhausted"). */
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

/** 401 — the API key is missing or invalid. */
export class AuthError extends ConnectorError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'unauthorized');
  }
}

/** 402 — the tenant's prepaid quota is set and fully consumed. */
export class QuotaExhaustedError extends ConnectorError {
  constructor(message = 'quota_exhausted') {
    super(message, 402, 'quota_exhausted');
  }
}

/** 404 — the session does not exist (or belongs to another tenant). */
export class SessionNotFoundError extends ConnectorError {
  constructor(message = 'Session not found') {
    super(message, 404, 'session_not_found');
  }
}

/** 409 — the session exists but is not active (already closed). */
export class SessionNotActiveError extends ConnectorError {
  constructor(message = 'Session is not active') {
    super(message, 409, 'session_not_active');
  }
}

/** 501 — voice input was sent but no STT provider is configured. */
export class SttNotConfiguredError extends ConnectorError {
  constructor(message = 'STT not configured') {
    super(message, 501, 'stt_provider_not_configured');
  }
}

/** Network-level failure: the request could not be completed (fetch threw, timed out, or the host was unreachable). */
export class NetworkError extends ConnectorError {
  constructor(message: string) {
    super(message, 0, 'network_error');
  }
}
