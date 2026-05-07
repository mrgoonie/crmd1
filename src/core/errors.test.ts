import { describe, it, expect } from 'vitest';
import { CrmdError, ErrorCode, serializeError, isRetryable } from './errors.js';

describe('CrmdError', () => {
  it('constructs with code, message, retryable defaults', () => {
    const e = new CrmdError(ErrorCode.NOT_FOUND, 'entity missing');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('entity missing');
    expect(e.retryable).toBe(false);
    expect(e.name).toBe('CrmdError');
    expect(e instanceof CrmdError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });

  it('marks RATE_LIMIT and NETWORK as retryable by default', () => {
    expect(new CrmdError(ErrorCode.RATE_LIMIT, 'slow down').retryable).toBe(true);
    expect(new CrmdError(ErrorCode.NETWORK, 'timeout').retryable).toBe(true);
  });

  it('caller can override retryable flag', () => {
    const e = new CrmdError(ErrorCode.DB_ERROR, 'transient', { retryable: true });
    expect(e.retryable).toBe(true);
  });

  it('stores optional details and retry_after_ms', () => {
    const e = new CrmdError(ErrorCode.RATE_LIMIT, 'slow', {
      details: { limit: 100 },
      retry_after_ms: 5000,
    });
    expect(e.details).toEqual({ limit: 100 });
    expect(e.retry_after_ms).toBe(5000);
  });

  it('toJSON returns structured error shape', () => {
    const e = new CrmdError(ErrorCode.INVALID_INPUT, 'bad field', {
      details: { field: 'email' },
    });
    const json = e.toJSON();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('INVALID_INPUT');
    expect(json.error.message).toBe('bad field');
    expect(json.error.retryable).toBe(false);
    expect(json.error.details).toEqual({ field: 'email' });
  });

  it('toJSON omits undefined optional fields', () => {
    const e = new CrmdError(ErrorCode.AUTH_MISSING, 'no token');
    const json = e.toJSON();
    expect('details' in json.error).toBe(false);
    expect('retry_after_ms' in json.error).toBe(false);
  });
});

describe('serializeError', () => {
  it('serializes CrmdError correctly', () => {
    const e = new CrmdError(ErrorCode.ORG_NOT_FOUND, 'missing org', {
      details: { slug: 'acme' },
    });
    const s = serializeError(e);
    expect(s.code).toBe('ORG_NOT_FOUND');
    expect(s.message).toBe('missing org');
    expect(s.retryable).toBe(false);
    expect(s.details).toEqual({ slug: 'acme' });
  });

  it('serializes plain Error as INTERNAL', () => {
    const s = serializeError(new Error('boom'));
    expect(s.code).toBe('INTERNAL');
    expect(s.retryable).toBe(false);
  });

  it('serializes unknown value as INTERNAL', () => {
    const s = serializeError('unexpected string');
    expect(s.code).toBe('INTERNAL');
    expect(s.message).toBe('unexpected string');
  });
});

describe('isRetryable', () => {
  it('returns true for RATE_LIMIT and NETWORK', () => {
    expect(isRetryable(ErrorCode.RATE_LIMIT)).toBe(true);
    expect(isRetryable(ErrorCode.NETWORK)).toBe(true);
  });

  it('returns false for non-retryable codes', () => {
    expect(isRetryable(ErrorCode.AUTH_MISSING)).toBe(false);
    expect(isRetryable(ErrorCode.INVALID_INPUT)).toBe(false);
    expect(isRetryable(ErrorCode.INTERNAL)).toBe(false);
  });
});
