/**
 * Unit tests for D1Client — all HTTP interactions mocked via fetchImpl.
 * Covers: success paths, each error mapping, guards, batch shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { D1Client } from './d1-client.js';
import { CrmdError, ErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope<T>(result: T, success = true) {
  return { success, result, errors: [], messages: [] };
}

function makeErrorEnvelope(errors: Array<{ code: number; message: string }>) {
  return { success: false, result: null, errors, messages: [] };
}

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body),
  });
}

const DB_ID = 'test-db-id';
const ACCOUNT_ID = 'test-account';
const TOKEN = 'test-token-1234';

function makeClient(fetchImpl: typeof fetch) {
  return new D1Client({
    token: TOKEN,
    accountId: ACCOUNT_ID,
    databaseId: DB_ID,
    baseUrl: 'https://mock.cf',
    fetchImpl,
  });
}

// ---------------------------------------------------------------------------
// query()
// ---------------------------------------------------------------------------

describe('D1Client.query()', () => {
  it('returns results and meta on success', async () => {
    const resultItem = {
      success: true,
      meta: { rows_read: 1, rows_written: 0, duration: 2 },
      results: [{ id: 'abc', name: 'Test' }],
    };
    const fetch = mockFetch(200, makeEnvelope([resultItem]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    const result = await client.query('SELECT * FROM contacts');

    expect(result.results).toEqual([{ id: 'abc', name: 'Test' }]);
    expect(result.meta.rows_read).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/query');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('passes params in request body', async () => {
    const resultItem = {
      success: true,
      meta: { rows_read: 1, rows_written: 0, duration: 1 },
      results: [],
    };
    const fetch = mockFetch(200, makeEnvelope([resultItem]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    await client.query('SELECT * FROM contacts WHERE id = ?', ['id-1']);

    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.params).toEqual(['id-1']);
  });

  it('throws INVALID_INPUT when sql exceeds 100KB', async () => {
    const fetch = mockFetch(200, {});
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);
    const bigSql = 'SELECT ' + 'x'.repeat(100_001);

    await expect(client.query(bigSql)).rejects.toMatchObject({
      code: ErrorCode.INVALID_INPUT,
    });
  });

  it('throws INVALID_INPUT when params exceed 100', async () => {
    const fetch = mockFetch(200, {});
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);
    const params = Array.from({ length: 101 }, (_, i) => i);

    await expect(client.query('SELECT 1', params)).rejects.toMatchObject({
      code: ErrorCode.INVALID_INPUT,
    });
  });

  it('throws INVALID_INPUT when no databaseId set', async () => {
    const fetch = mockFetch(200, {});
    const client = new D1Client({
      token: TOKEN,
      accountId: ACCOUNT_ID,
      baseUrl: 'https://mock.cf',
      fetchImpl: fetch as unknown as typeof globalThis.fetch,
    });

    await expect(client.query('SELECT 1')).rejects.toMatchObject({
      code: ErrorCode.INVALID_INPUT,
    });
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe('D1Client error mapping', () => {
  it('maps 401 to AUTH_INVALID', async () => {
    const fetch = mockFetch(401, makeErrorEnvelope([{ code: 10000, message: 'unauthorized' }]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    await expect(client.query('SELECT 1')).rejects.toMatchObject({
      code: ErrorCode.AUTH_INVALID,
    });
  });

  it('maps 403 to AUTH_INVALID', async () => {
    const fetch = mockFetch(403, makeErrorEnvelope([{ code: 10001, message: 'forbidden' }]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    await expect(client.query('SELECT 1')).rejects.toMatchObject({
      code: ErrorCode.AUTH_INVALID,
    });
  });

  it('maps 404 to NOT_FOUND', async () => {
    const fetch = mockFetch(404, makeErrorEnvelope([{ code: 7400, message: 'not found' }]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    await expect(client.query('SELECT 1')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('maps 409 to ORG_EXISTS', async () => {
    const fetch = mockFetch(409, makeErrorEnvelope([{ code: 7409, message: 'conflict' }]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    await expect(client.createDb('my-db')).rejects.toMatchObject({
      code: ErrorCode.ORG_EXISTS,
    });
  });

  it('maps 429 to RATE_LIMIT with retry_after_ms', async () => {
    const fetch = mockFetch(
      429,
      makeErrorEnvelope([{ code: 10003, message: 'rate limited' }]),
      { 'retry-after': '5' },
    );
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    const err = await client.query('SELECT 1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrmdError);
    const crmdErr = err as CrmdError;
    expect(crmdErr.code).toBe(ErrorCode.RATE_LIMIT);
    expect(crmdErr.retry_after_ms).toBe(5000);
    expect(crmdErr.retryable).toBe(true);
  });

  it('maps 500 to DB_ERROR', async () => {
    const fetch = mockFetch(500, makeErrorEnvelope([{ code: 10002, message: 'internal error' }]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    await expect(client.query('SELECT 1')).rejects.toMatchObject({
      code: ErrorCode.DB_ERROR,
    });
  });

  it('maps network error to NETWORK', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    await expect(client.query('SELECT 1')).rejects.toMatchObject({
      code: ErrorCode.NETWORK,
    });
  });
});

// ---------------------------------------------------------------------------
// batch()
// ---------------------------------------------------------------------------

describe('D1Client.batch()', () => {
  it('returns array of results', async () => {
    const items = [
      { success: true, meta: { rows_read: 1, rows_written: 1, duration: 1 }, results: [] },
      { success: true, meta: { rows_read: 0, rows_written: 1, duration: 1 }, results: [] },
    ];
    const fetch = mockFetch(200, makeEnvelope(items));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    const results = await client.batch([
      { sql: 'INSERT INTO contacts(id) VALUES (?)', params: ['id1'] },
      { sql: 'INSERT INTO contacts(id) VALUES (?)', params: ['id2'] },
    ]);

    expect(results).toHaveLength(2);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/batch');
    const body = JSON.parse(init.body as string);
    expect(body.statements).toHaveLength(2);
  });

  it('returns empty array for empty input', async () => {
    const fetch = mockFetch(200, makeEnvelope([]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    const results = await client.batch([]);
    expect(results).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws INVALID_INPUT when batch exceeds 1000', async () => {
    const fetch = mockFetch(200, makeEnvelope([]));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);
    const stmts = Array.from({ length: 1001 }, (_, i) => ({ sql: `SELECT ${i}` }));

    await expect(client.batch(stmts)).rejects.toMatchObject({
      code: ErrorCode.INVALID_INPUT,
    });
  });
});

// ---------------------------------------------------------------------------
// Management endpoints
// ---------------------------------------------------------------------------

describe('D1Client management', () => {
  it('createDb posts name and returns db record', async () => {
    const db = { uuid: 'db-uuid', name: 'crmd1-acme' };
    const fetch = mockFetch(200, makeEnvelope(db));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    const result = await client.createDb('crmd1-acme');

    expect(result.uuid).toBe('db-uuid');
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/d1/database');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'crmd1-acme' });
  });

  it('listDbs returns array', async () => {
    const dbs = [{ uuid: 'a', name: 'db-a' }, { uuid: 'b', name: 'db-b' }];
    const fetch = mockFetch(200, makeEnvelope(dbs));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    const result = await client.listDbs();
    expect(result).toHaveLength(2);
  });

  it('deleteDb sends DELETE request', async () => {
    const fetch = mockFetch(200, makeEnvelope({}));
    const client = makeClient(fetch as unknown as typeof globalThis.fetch);

    await client.deleteDb('db-uuid');

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(url).toContain('db-uuid');
  });
});

// ---------------------------------------------------------------------------
// withDatabase()
// ---------------------------------------------------------------------------

describe('D1Client.withDatabase()', () => {
  it('returns new client bound to given dbId', async () => {
    const resultItem = {
      success: true,
      meta: { rows_read: 1, rows_written: 0, duration: 1 },
      results: [],
    };
    const fetch = mockFetch(200, makeEnvelope([resultItem]));
    const baseClient = new D1Client({
      token: TOKEN,
      accountId: ACCOUNT_ID,
      baseUrl: 'https://mock.cf',
      fetchImpl: fetch as unknown as typeof globalThis.fetch,
    });
    const bound = baseClient.withDatabase('new-db-id');

    await bound.query('SELECT 1');

    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('new-db-id');
  });
});
