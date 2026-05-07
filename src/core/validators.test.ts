import { describe, it, expect } from 'vitest';
import {
  OrgSlugSchema,
  EmailSchema,
  DomainSchema,
  CurrencySchema,
  PaginationSchema,
  IdempotencyKeySchema,
  EntityTypeSchema,
  AuditFieldsSchema,
  CustomFieldsSchema,
} from './validators.js';

describe('OrgSlugSchema', () => {
  it('accepts valid slugs', () => {
    expect(OrgSlugSchema.parse('acme')).toBe('acme');
    expect(OrgSlugSchema.parse('my-org')).toBe('my-org');
    expect(OrgSlugSchema.parse('org123')).toBe('org123');
    expect(OrgSlugSchema.parse('a')).toBe('a');
  });

  it('rejects slugs starting with hyphen', () => {
    expect(() => OrgSlugSchema.parse('-bad')).toThrow();
  });

  it('rejects uppercase letters', () => {
    expect(() => OrgSlugSchema.parse('MyOrg')).toThrow();
  });

  it('rejects slugs longer than 63 chars', () => {
    expect(() => OrgSlugSchema.parse('a'.repeat(64))).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => OrgSlugSchema.parse('')).toThrow();
  });
});

describe('EmailSchema', () => {
  it('accepts valid email', () => {
    expect(EmailSchema.parse('user@example.com')).toBe('user@example.com');
  });

  it('rejects missing @', () => {
    expect(() => EmailSchema.parse('notanemail')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => EmailSchema.parse('')).toThrow();
  });
});

describe('DomainSchema', () => {
  it('accepts valid domains', () => {
    expect(DomainSchema.parse('example.com')).toBe('example.com');
    expect(DomainSchema.parse('sub.example.co.uk')).toBe('sub.example.co.uk');
  });

  it('rejects domain with protocol prefix', () => {
    expect(() => DomainSchema.parse('https://example.com')).toThrow();
  });

  it('rejects bare hostname without TLD', () => {
    expect(() => DomainSchema.parse('localhost')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => DomainSchema.parse('')).toThrow();
  });
});

describe('CurrencySchema', () => {
  it('accepts valid 3-letter uppercase codes', () => {
    expect(CurrencySchema.parse('USD')).toBe('USD');
    expect(CurrencySchema.parse('EUR')).toBe('EUR');
    expect(CurrencySchema.parse('VND')).toBe('VND');
  });

  it('rejects lowercase', () => {
    expect(() => CurrencySchema.parse('usd')).toThrow();
  });

  it('rejects wrong length', () => {
    expect(() => CurrencySchema.parse('US')).toThrow();
    expect(() => CurrencySchema.parse('USDA')).toThrow();
  });
});

describe('PaginationSchema', () => {
  it('provides default limit of 50', () => {
    const result = PaginationSchema.parse({});
    expect(result.limit).toBe(50);
  });

  it('accepts valid limit and cursor', () => {
    const result = PaginationSchema.parse({ limit: 10, cursor: 'tok123' });
    expect(result.limit).toBe(10);
    expect(result.cursor).toBe('tok123');
  });

  it('rejects limit below 1', () => {
    expect(() => PaginationSchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects limit above 100', () => {
    expect(() => PaginationSchema.parse({ limit: 101 })).toThrow();
  });
});

describe('IdempotencyKeySchema', () => {
  it('accepts valid key', () => {
    expect(IdempotencyKeySchema.parse('unique-request-key')).toBe('unique-request-key');
  });

  it('accepts undefined (optional)', () => {
    expect(IdempotencyKeySchema.parse(undefined)).toBeUndefined();
  });

  it('rejects empty string', () => {
    expect(() => IdempotencyKeySchema.parse('')).toThrow();
  });

  it('rejects key longer than 128 chars', () => {
    expect(() => IdempotencyKeySchema.parse('a'.repeat(129))).toThrow();
  });
});

describe('EntityTypeSchema', () => {
  it('accepts all valid entity types', () => {
    const types = ['contact', 'company', 'deal', 'activity', 'task'] as const;
    for (const t of types) {
      expect(EntityTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects unknown type', () => {
    expect(() => EntityTypeSchema.parse('invoice')).toThrow();
  });
});

describe('AuditFieldsSchema', () => {
  it('accepts empty object (all optional)', () => {
    expect(() => AuditFieldsSchema.parse({})).not.toThrow();
  });

  it('accepts full audit object', () => {
    const result = AuditFieldsSchema.parse({
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
      deleted_at: null,
      created_by: 'user-1',
      updated_by: 'user-2',
    });
    expect(result.created_by).toBe('user-1');
  });

  it('rejects invalid datetime string', () => {
    expect(() => AuditFieldsSchema.parse({ created_at: 'not-a-date' })).toThrow();
  });
});

describe('CustomFieldsSchema', () => {
  it('accepts arbitrary key-value record', () => {
    const result = CustomFieldsSchema.parse({ foo: 'bar', count: 42, nested: { x: 1 } });
    expect(result?.['foo']).toBe('bar');
  });

  it('accepts undefined', () => {
    expect(CustomFieldsSchema.parse(undefined)).toBeUndefined();
  });
});
