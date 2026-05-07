/**
 * Tests for cursor encode/decode round-trip and error handling.
 */

import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from './cursor.js';
import { CrmdError } from '../../errors.js';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips correctly', () => {
    const data = { last_created_at: '2024-01-15T10:30:00.000Z', last_id: 'abc-123' };
    const encoded = encodeCursor(data);
    expect(typeof encoded).toBe('string');
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(data);
  });

  it('produces a URL-safe base64 string (no +, /, =)', () => {
    const encoded = encodeCursor({ last_created_at: '2024-01-01T00:00:00.000Z', last_id: 'x' });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('throws INVALID_INPUT on garbage string', () => {
    expect(() => decodeCursor('not-valid-base64!!!')).toThrow(CrmdError);
    try {
      decodeCursor('!!!');
    } catch (e) {
      expect(e).toBeInstanceOf(CrmdError);
    }
  });

  it('throws INVALID_INPUT on valid base64 but wrong shape', () => {
    const bad = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(CrmdError);
  });

  it('throws INVALID_INPUT on valid base64 but non-JSON', () => {
    const bad = Buffer.from('not json at all').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(CrmdError);
  });
});
