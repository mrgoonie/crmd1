import { describe, it, expect } from 'vitest';
import { newId, isValidId, isUuidV7 } from './ids.js';

describe('newId', () => {
  it('returns a string of length 36', () => {
    expect(newId()).toHaveLength(36);
  });

  it('returns a valid UUID v7', () => {
    const id = newId();
    expect(isUuidV7(id)).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });
});

describe('isValidId', () => {
  it('accepts a valid UUID v4', () => {
    expect(isValidId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts a valid UUID v7', () => {
    const id = newId();
    expect(isValidId(id)).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidId('')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidId('not-a-uuid')).toBe(false);
    expect(isValidId('550e8400-e29b-41d4-a716')).toBe(false);
    expect(isValidId('550e8400e29b41d4a716446655440000')).toBe(false);
  });
});

describe('isUuidV7', () => {
  it('accepts a freshly generated UUID v7', () => {
    expect(isUuidV7(newId())).toBe(true);
  });

  it('rejects a UUID v4 (version nibble != 7)', () => {
    expect(isUuidV7('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isUuidV7('not-valid')).toBe(false);
  });
});
