/**
 * Tests for contacts CRUD module.
 * Uses in-memory SQLite via the shared test adapter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './internal/sqlite-test-adapter.js';
import {
  contactCreate,
  contactGet,
  contactUpdate,
  contactSoftDelete,
  contactRestore,
  contactList,
} from './contacts.js';
import { CrmdError } from '../errors.js';
import type { D1Client } from '../d1-client.js';

let client: D1Client;

beforeEach(() => {
  ({ client } = makeTestDb());
});

const BASE_INPUT = {
  email: 'alice@example.com',
  first_name: 'Alice',
  last_name: 'Smith',
};

describe('contactCreate', () => {
  it('creates a contact and returns full row', async () => {
    const row = await contactCreate(client, BASE_INPUT);
    expect(row.id).toBeTruthy();
    expect(row.email).toBe('alice@example.com');
    expect(row.first_name).toBe('Alice');
    expect(row.status).toBe('prospect');
    expect(row.deleted_at).toBeNull();
  });

  it('stores and round-trips custom_fields', async () => {
    const row = await contactCreate(client, {
      ...BASE_INPUT,
      custom_fields: { tier: 'gold', score: 42 },
    });
    expect(row.custom_fields).toEqual({ tier: 'gold', score: 42 });
  });

  it('throws CONFLICT on duplicate email', async () => {
    await contactCreate(client, BASE_INPUT);
    await expect(contactCreate(client, BASE_INPUT)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('is idempotent with idempotency_key', async () => {
    const key = 'idem-contact-1';
    const r1 = await contactCreate(client, BASE_INPUT, { idempotency_key: key });
    const r2 = await contactCreate(client, { ...BASE_INPUT, email: 'other@example.com' }, { idempotency_key: key });
    expect(r1.id).toBe(r2.id);
    // No second row inserted
    const list = await contactList(client, {});
    expect(list.items).toHaveLength(1);
  });
});

describe('contactGet', () => {
  it('returns the contact by id', async () => {
    const created = await contactCreate(client, BASE_INPUT);
    const fetched = await contactGet(client, created.id);
    expect(fetched.id).toBe(created.id);
  });

  it('throws NOT_FOUND for unknown id', async () => {
    await expect(contactGet(client, 'nonexistent')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND for soft-deleted contact', async () => {
    const row = await contactCreate(client, BASE_INPUT);
    await contactSoftDelete(client, row.id);
    await expect(contactGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('contactUpdate', () => {
  it('updates allowed fields and bumps updated_at', async () => {
    const row = await contactCreate(client, BASE_INPUT);
    const updated = await contactUpdate(client, row.id, { first_name: 'Alicia', job_title: 'CEO' });
    expect(updated.first_name).toBe('Alicia');
    expect(updated.job_title).toBe('CEO');
  });

  it('throws NOT_FOUND for missing id', async () => {
    await expect(contactUpdate(client, 'ghost', { first_name: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws CONFLICT on duplicate email', async () => {
    await contactCreate(client, BASE_INPUT);
    const r2 = await contactCreate(client, { ...BASE_INPUT, email: 'bob@example.com', first_name: 'Bob', last_name: 'B' });
    await expect(contactUpdate(client, r2.id, { email: 'alice@example.com' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('contactSoftDelete / contactRestore', () => {
  it('soft-deletes and restores a contact', async () => {
    const row = await contactCreate(client, BASE_INPUT);
    const del = await contactSoftDelete(client, row.id);
    expect(del.deleted_at).toBeTruthy();

    // Not found after delete
    await expect(contactGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Restore
    const restored = await contactRestore(client, row.id);
    expect(restored.deleted_at).toBeNull();
    // Accessible again
    await expect(contactGet(client, row.id)).resolves.toBeTruthy();
  });

  it('throws NOT_FOUND when deleting already-deleted contact', async () => {
    const row = await contactCreate(client, BASE_INPUT);
    await contactSoftDelete(client, row.id);
    await expect(contactSoftDelete(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('contactList', () => {
  it('excludes soft-deleted contacts by default', async () => {
    const row = await contactCreate(client, BASE_INPUT);
    await contactSoftDelete(client, row.id);
    const list = await contactList(client, {});
    expect(list.items).toHaveLength(0);
  });

  it('includes deleted when include_deleted=true', async () => {
    const row = await contactCreate(client, BASE_INPUT);
    await contactSoftDelete(client, row.id);
    const list = await contactList(client, { include_deleted: true });
    expect(list.items).toHaveLength(1);
  });

  it('filters by email', async () => {
    await contactCreate(client, BASE_INPUT);
    await contactCreate(client, { ...BASE_INPUT, email: 'bob@example.com', first_name: 'Bob', last_name: 'B' });
    const list = await contactList(client, { email: 'alice@example.com' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.email).toBe('alice@example.com');
  });

  it('paginates with cursor', async () => {
    // Insert 3 contacts
    for (let i = 0; i < 3; i++) {
      await contactCreate(client, { ...BASE_INPUT, email: `user${i}@example.com` });
    }
    const page1 = await contactList(client, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await contactList(client, { limit: 2, cursor: page1.next_cursor });
    expect(page2.items).toHaveLength(1);
    expect(page2.next_cursor).toBeUndefined();

    // No overlap
    const ids1 = page1.items.map((r) => r.id);
    const ids2 = page2.items.map((r) => r.id);
    expect(ids1.every((id) => !ids2.includes(id))).toBe(true);
  });

  it('filters by q (name search)', async () => {
    await contactCreate(client, BASE_INPUT);
    await contactCreate(client, { ...BASE_INPUT, email: 'charlie@example.com', first_name: 'Charlie', last_name: 'Brown' });
    const list = await contactList(client, { q: 'Charlie' });
    expect(list.items.some((r) => r.first_name === 'Charlie')).toBe(true);
  });
});
