/**
 * Thin REST wrapper around Cloudflare D1 HTTP API.
 * Handles query/raw/batch execution + management endpoints (createDb, listDbs, deleteDb).
 * No ORM, no Wrangler dependency.
 */

import { CrmdError, ErrorCode } from './errors.js';
import { logger, redactToken } from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface D1ClientOpts {
  token: string;
  accountId: string;
  databaseId?: string;
  baseUrl?: string;
  /** Override fetch for tests */
  fetchImpl?: typeof fetch;
}

export interface D1QueryMeta {
  rows_read: number;
  rows_written: number;
  duration: number;
}

export interface D1QueryResult<T = Record<string, unknown>> {
  results: T[];
  meta: D1QueryMeta;
}

export interface D1Statement {
  sql: string;
  params?: unknown[];
}

export interface D1Database {
  uuid: string;
  name: string;
  created_at?: string;
  version?: string;
}

/** Cloudflare API envelope shape */
interface CfEnvelope<T> {
  success: boolean;
  result: T;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
}

/** Batch response: array of per-statement results */
interface D1BatchResultItem {
  success: boolean;
  meta: D1QueryMeta;
  results: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_SQL_BYTES = 100_000;
const MAX_PARAMS = 100;
const MAX_BATCH_STMTS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// D1Client
// ---------------------------------------------------------------------------

export class D1Client {
  private readonly token: string;
  private readonly accountId: string;
  private readonly databaseId: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: D1ClientOpts) {
    this.token = opts.token;
    this.accountId = opts.accountId;
    this.databaseId = opts.databaseId;
    this.baseUrl = opts.baseUrl?.replace(/\/$/, '') ?? 'https://api.cloudflare.com/client/v4';
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /** Returns a new client bound to the given database ID. */
  withDatabase(dbId: string): D1Client {
    return new D1Client({
      token: this.token,
      accountId: this.accountId,
      databaseId: dbId,
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
    });
  }

  // -------------------------------------------------------------------------
  // Query / Batch
  // -------------------------------------------------------------------------

  /**
   * Execute a single parameterized SQL statement.
   * POST /accounts/{acc}/d1/database/{db}/query
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<D1QueryResult<T>> {
    const dbId = this.requireDbId();
    validateStatement(sql, params);

    const body = params && params.length > 0 ? { sql, params } : { sql };
    const envelope = await this.request<D1BatchResultItem[]>(
      `accounts/${this.accountId}/d1/database/${dbId}/query`,
      { method: 'POST', body: JSON.stringify(body) },
    );

    const first = envelope.result[0];
    if (!first) throw new CrmdError(ErrorCode.DB_ERROR, 'D1 query returned empty result array');
    return { results: first.results as T[], meta: first.meta };
  }

  /**
   * Execute a single SQL statement returning columnar (raw) arrays.
   * POST /accounts/{acc}/d1/database/{db}/raw
   */
  async raw(
    sql: string,
    params?: unknown[],
  ): Promise<{ columns: string[]; rows: unknown[][]; meta: D1QueryMeta }> {
    const dbId = this.requireDbId();
    validateStatement(sql, params);

    const body = params && params.length > 0 ? { sql, params } : { sql };
    const envelope = await this.request<
      Array<{ columns: string[]; rows: unknown[][]; meta: D1QueryMeta; success: boolean }>
    >(
      `accounts/${this.accountId}/d1/database/${dbId}/raw`,
      { method: 'POST', body: JSON.stringify(body) },
    );

    const first = envelope.result[0];
    if (!first) throw new CrmdError(ErrorCode.DB_ERROR, 'D1 raw returned empty result array');
    return { columns: first.columns, rows: first.rows, meta: first.meta };
  }

  /**
   * Execute multiple statements in one request.
   * POST /accounts/{acc}/d1/database/{db}/batch
   */
  async batch(stmts: D1Statement[]): Promise<D1QueryResult[]> {
    const dbId = this.requireDbId();
    if (stmts.length === 0) return [];
    if (stmts.length > MAX_BATCH_STMTS) {
      throw new CrmdError(
        ErrorCode.INVALID_INPUT,
        `Batch size ${stmts.length} exceeds max ${MAX_BATCH_STMTS}. Split into smaller batches.`,
      );
    }
    for (const s of stmts) validateStatement(s.sql, s.params);

    const statements = stmts.map((s) =>
      s.params && s.params.length > 0 ? { sql: s.sql, params: s.params } : { sql: s.sql },
    );

    const envelope = await this.request<D1BatchResultItem[]>(
      `accounts/${this.accountId}/d1/database/${dbId}/batch`,
      { method: 'POST', body: JSON.stringify({ statements }) },
    );

    return envelope.result.map((r) => ({ results: r.results, meta: r.meta }));
  }

  // -------------------------------------------------------------------------
  // Management
  // -------------------------------------------------------------------------

  /** GET /accounts/{acc}/d1/database — lists all databases */
  async listDbs(): Promise<D1Database[]> {
    const envelope = await this.request<D1Database[]>(
      `accounts/${this.accountId}/d1/database`,
      { method: 'GET' },
    );
    return envelope.result;
  }

  /** POST /accounts/{acc}/d1/database — creates a new database */
  async createDb(name: string): Promise<D1Database> {
    const envelope = await this.request<D1Database>(
      `accounts/${this.accountId}/d1/database`,
      { method: 'POST', body: JSON.stringify({ name }) },
    );
    return envelope.result;
  }

  /** DELETE /accounts/{acc}/d1/database/{uuid} */
  async deleteDb(dbId: string): Promise<void> {
    await this.request<unknown>(
      `accounts/${this.accountId}/d1/database/${dbId}`,
      { method: 'DELETE' },
    );
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private requireDbId(): string {
    if (!this.databaseId) {
      throw new CrmdError(
        ErrorCode.INVALID_INPUT,
        'D1Client has no databaseId set. Use withDatabase(dbId) or pass databaseId in constructor.',
      );
    }
    return this.databaseId;
  }

  private async request<T>(path: string, init: RequestInit): Promise<CfEnvelope<T>> {
    const url = `${this.baseUrl}/${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    logger.debug('D1 request', {
      method: init.method,
      path,
      token: redactToken(this.token),
    });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort =
        err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      if (isAbort) {
        throw new CrmdError(
          ErrorCode.DB_ERROR,
          `D1 request timed out after ${REQUEST_TIMEOUT_MS}ms`,
          { cause: err },
        );
      }
      throw new CrmdError(ErrorCode.NETWORK, `Network error: ${String(err)}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }

    // Parse JSON body
    let envelope: CfEnvelope<T>;
    try {
      envelope = (await response.json()) as CfEnvelope<T>;
    } catch (err) {
      throw new CrmdError(
        ErrorCode.DB_ERROR,
        `D1 API returned non-JSON response (HTTP ${response.status})`,
        { cause: err },
      );
    }

    if (!response.ok || !envelope.success) {
      throw mapHttpError(response, envelope.errors ?? []);
    }

    return envelope;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateStatement(sql: string, params?: unknown[]): void {
  const byteLen = Buffer.byteLength(sql, 'utf8');
  if (byteLen > MAX_SQL_BYTES) {
    throw new CrmdError(
      ErrorCode.INVALID_INPUT,
      `SQL statement exceeds ${MAX_SQL_BYTES} byte limit (got ${byteLen} bytes)`,
    );
  }
  if (params && params.length > MAX_PARAMS) {
    throw new CrmdError(
      ErrorCode.INVALID_INPUT,
      `Query has ${params.length} params; max is ${MAX_PARAMS}`,
    );
  }
}

function mapHttpError(
  res: Response,
  errors: Array<{ code: number; message: string }>,
): CrmdError {
  const cfMsg = errors[0]?.message ?? '';
  const cfCode = errors[0]?.code;

  switch (res.status) {
    case 401:
    case 403:
      return new CrmdError(
        ErrorCode.AUTH_INVALID,
        `Cloudflare auth failed (HTTP ${res.status})${cfMsg ? `: ${cfMsg}` : ''}`,
      );
    case 404:
      return new CrmdError(
        ErrorCode.NOT_FOUND,
        `D1 resource not found${cfMsg ? `: ${cfMsg}` : ''}`,
      );
    case 409:
      return new CrmdError(
        ErrorCode.ORG_EXISTS,
        `D1 conflict${cfMsg ? `: ${cfMsg}` : ''}`,
      );
    case 429: {
      const retryAfterHeader = res.headers.get('Retry-After') ?? res.headers.get('retry-after');
      const retry_after_ms = retryAfterHeader ? parseRetryAfter(retryAfterHeader) : undefined;
      return new CrmdError(
        ErrorCode.RATE_LIMIT,
        `D1 rate limited${cfMsg ? `: ${cfMsg}` : ''}`,
        { retry_after_ms },
      );
    }
    default:
      if (res.status >= 500) {
        return new CrmdError(
          ErrorCode.DB_ERROR,
          `D1 server error (HTTP ${res.status})${cfMsg ? `: ${cfMsg}` : ''}`,
          { details: cfCode !== undefined ? { cf_error_code: cfCode } : undefined },
        );
      }
      return new CrmdError(
        ErrorCode.DB_ERROR,
        `D1 request failed (HTTP ${res.status})${cfMsg ? `: ${cfMsg}` : ''}`,
        { details: cfCode !== undefined ? { cf_error_code: cfCode } : undefined },
      );
  }
}

function parseRetryAfter(header: string): number {
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return Math.round(seconds * 1000);
  // HTTP-date format fallback
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return 1000; // fallback 1s
}
