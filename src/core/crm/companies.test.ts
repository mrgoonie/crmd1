/**
 * Tests for companies CRUD module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './internal/sqlite-test-adapter.js';
import {
  companyCreate,
  companyGet,
  companyUpdate,
  companySoftDelete,
  companyRestore,
  companyList,
} from './companies.js';
import type { D1Client } from '../d1-client.js';

let client: D1Client;

beforeEach(() => {
  ({ client } = makeTestDb());
});

const BASE = { name: 'Acme Corp', domain: 'acme.com' };

describe('companyCreate', () => {
  it('creates a company and returns full row', async () => {
    const row = await companyCreate(client, BASE);
    expect(row.id).toBeTruthy();
    expect(row.name).toBe('Acme Corp');
    expect(row.domain).toBe('acme.com');
    expect(row.status).toBe('active');
    expect(row.deleted_at).toBeNull();
  });

  it('stores custom_fields', async () => {
    const row = await companyCreate(client, { ...BASE, custom_fields: { region: 'US' } });
    expect(row.custom_fields).toEqual({ region: 'US' });
  });

  it('throws CONFLICT on duplicate domain', async () => {
    await companyCreate(client, BASE);
    await expect(companyCreate(client, { name: 'Other', domain: 'acme.com' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('is idempotent with idempotency_key', async () => {
    const key = 'idem-co-1';
    const r1 = await companyCreate(client, BASE, { idempotency_key: key });
    const r2 = await companyCreate(client, { name: 'Different', domain: 'other.com' }, { idempotency_key: key });
    expect(r1.id).toBe(r2.id);
  });
});

describe('companyGet', () => {
  it('returns company by id', async () => {
    const row = await companyCreate(client, BASE);
    const fetched = await companyGet(client, row.id);
    expect(fetched.id).toBe(row.id);
  });

  it('throws NOT_FOUND for unknown id', async () => {
    await expect(companyGet(client, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND for soft-deleted company', async () => {
    const row = await companyCreate(client, BASE);
    await companySoftDelete(client, row.id);
    await expect(companyGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('companyUpdate', () => {
  it('updates name and industry', async () => {
    const row = await companyCreate(client, BASE);
    const updated = await companyUpdate(client, row.id, { name: 'Acme Inc', industry: 'Tech' });
    expect(updated.name).toBe('Acme Inc');
    expect(updated.industry).toBe('Tech');
  });

  it('throws CONFLICT on duplicate domain update', async () => {
    await companyCreate(client, BASE);
    const r2 = await companyCreate(client, { name: 'Beta', domain: 'beta.com' });
    await expect(companyUpdate(client, r2.id, { domain: 'acme.com' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('companySoftDelete / companyRestore', () => {
  it('soft-deletes then restores', async () => {
    const row = await companyCreate(client, BASE);
    await companySoftDelete(client, row.id);
    await expect(companyGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const restored = await companyRestore(client, row.id);
    expect(restored.deleted_at).toBeNull();
  });
});

describe('companyList', () => {
  it('excludes soft-deleted by default', async () => {
    const row = await companyCreate(client, BASE);
    await companySoftDelete(client, row.id);
    const list = await companyList(client, {});
    expect(list.items).toHaveLength(0);
  });

  it('filters by domain', async () => {
    await companyCreate(client, BASE);
    await companyCreate(client, { name: 'Beta', domain: 'beta.com' });
    const list = await companyList(client, { domain: 'acme.com' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.domain).toBe('acme.com');
  });

  it('paginates with cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await companyCreate(client, { name: `Co ${i}`, domain: `co${i}.com` });
    }
    const page1 = await companyList(client, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await companyList(client, { limit: 2, cursor: page1.next_cursor });
    expect(page2.items).toHaveLength(1);
    expect(page2.next_cursor).toBeUndefined();
  });
});
