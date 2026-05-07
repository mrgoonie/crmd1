/**
 * Tests for deals CRUD module including linked_contacts helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './internal/sqlite-test-adapter.js';
import {
  dealCreate,
  dealGet,
  dealUpdate,
  dealSoftDelete,
  dealRestore,
  dealList,
  dealAddLinkedContact,
  dealRemoveLinkedContact,
} from './deals.js';
import { companyCreate } from './companies.js';
import { contactCreate } from './contacts.js';
import type { D1Client } from '../d1-client.js';

let client: D1Client;
let companyId: string;

beforeEach(async () => {
  ({ client } = makeTestDb());
  const co = await companyCreate(client, { name: 'Acme', domain: 'acme.com' });
  companyId = co.id;
});

const baseDeal = () => ({
  title: 'Big Deal',
  company_id: companyId,
  stage: 'prospect' as const,
  amount: 50000,
});

describe('dealCreate', () => {
  it('creates a deal with linked company', async () => {
    const row = await dealCreate(client, baseDeal());
    expect(row.id).toBeTruthy();
    expect(row.title).toBe('Big Deal');
    expect(row.company_id).toBe(companyId);
    expect(row.linked_contacts).toEqual([]);
    expect(row.deleted_at).toBeNull();
  });

  it('stores linked_contacts array', async () => {
    const contact = await contactCreate(client, {
      email: 'alice@acme.com', first_name: 'Alice', last_name: 'S',
    });
    const row = await dealCreate(client, { ...baseDeal(), linked_contacts: [contact.id] });
    expect(row.linked_contacts).toContain(contact.id);
  });

  it('is idempotent with idempotency_key', async () => {
    const key = 'idem-deal-1';
    const r1 = await dealCreate(client, baseDeal(), { idempotency_key: key });
    const r2 = await dealCreate(client, { ...baseDeal(), title: 'Other' }, { idempotency_key: key });
    expect(r1.id).toBe(r2.id);
  });
});

describe('dealGet', () => {
  it('returns deal by id', async () => {
    const row = await dealCreate(client, baseDeal());
    const fetched = await dealGet(client, row.id);
    expect(fetched.id).toBe(row.id);
  });

  it('throws NOT_FOUND for soft-deleted deal', async () => {
    const row = await dealCreate(client, baseDeal());
    await dealSoftDelete(client, row.id);
    await expect(dealGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('dealUpdate', () => {
  it('updates stage and amount', async () => {
    const row = await dealCreate(client, baseDeal());
    const updated = await dealUpdate(client, row.id, { stage: 'qualified', amount: 75000 });
    expect(updated.stage).toBe('qualified');
    expect(updated.amount).toBe(75000);
  });
});

describe('dealSoftDelete / dealRestore', () => {
  it('soft-deletes then restores', async () => {
    const row = await dealCreate(client, baseDeal());
    await dealSoftDelete(client, row.id);
    await expect(dealGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const restored = await dealRestore(client, row.id);
    expect(restored.deleted_at).toBeNull();
  });
});

describe('dealList', () => {
  it('excludes soft-deleted by default', async () => {
    const row = await dealCreate(client, baseDeal());
    await dealSoftDelete(client, row.id);
    const list = await dealList(client, {});
    expect(list.items).toHaveLength(0);
  });

  it('filters by stage', async () => {
    await dealCreate(client, baseDeal());
    await dealCreate(client, { ...baseDeal(), stage: 'closed_won' });
    const list = await dealList(client, { stage: 'prospect' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.stage).toBe('prospect');
  });

  it('filters by amount range', async () => {
    await dealCreate(client, { ...baseDeal(), amount: 1000 });
    await dealCreate(client, { ...baseDeal(), amount: 50000 });
    await dealCreate(client, { ...baseDeal(), amount: 100000 });
    const list = await dealList(client, { min_amount: 5000, max_amount: 60000 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.amount).toBe(50000);
  });

  it('paginates with cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await dealCreate(client, { ...baseDeal(), title: `Deal ${i}` });
    }
    const page1 = await dealList(client, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    const page2 = await dealList(client, { limit: 2, cursor: page1.next_cursor });
    expect(page2.items).toHaveLength(1);
  });
});

describe('dealAddLinkedContact / dealRemoveLinkedContact', () => {
  it('adds and removes a linked contact', async () => {
    const contact = await contactCreate(client, {
      email: 'link@acme.com', first_name: 'Link', last_name: 'Test',
    });
    const deal = await dealCreate(client, baseDeal());

    const afterAdd = await dealAddLinkedContact(client, deal.id, contact.id);
    expect(afterAdd.linked_contacts).toContain(contact.id);

    // idempotent add
    const afterAdd2 = await dealAddLinkedContact(client, deal.id, contact.id);
    expect(afterAdd2.linked_contacts.filter((id) => id === contact.id)).toHaveLength(1);

    const afterRemove = await dealRemoveLinkedContact(client, deal.id, contact.id);
    expect(afterRemove.linked_contacts).not.toContain(contact.id);
  });
});
