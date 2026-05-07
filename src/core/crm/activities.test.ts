/**
 * Tests for activities CRUD module (append-only, no update).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './internal/sqlite-test-adapter.js';
import {
  activityCreate,
  activityGet,
  activitySoftDelete,
  activityRestore,
  activityList,
} from './activities.js';
import { contactCreate } from './contacts.js';
import type { D1Client } from '../d1-client.js';

let client: D1Client;
let contactId: string;

beforeEach(async () => {
  ({ client } = makeTestDb());
  const c = await contactCreate(client, {
    email: 'alice@example.com', first_name: 'Alice', last_name: 'S',
  });
  contactId = c.id;
});

const baseActivity = () => ({
  entity_type: 'contact' as const,
  entity_id: contactId,
  activity_type: 'call' as const,
  summary: 'Introductory call',
});

describe('activityCreate', () => {
  it('creates an activity and returns full row', async () => {
    const row = await activityCreate(client, baseActivity());
    expect(row.id).toBeTruthy();
    expect(row.entity_type).toBe('contact');
    expect(row.entity_id).toBe(contactId);
    expect(row.activity_type).toBe('call');
    expect(row.summary).toBe('Introductory call');
    expect(row.deleted_at).toBeNull();
  });

  it('stores metadata as parsed object', async () => {
    const row = await activityCreate(client, {
      ...baseActivity(),
      metadata: { duration_min: 30, outcome: 'positive' },
    });
    expect(row.metadata).toEqual({ duration_min: 30, outcome: 'positive' });
  });

  it('is idempotent with idempotency_key', async () => {
    const key = 'idem-act-1';
    const r1 = await activityCreate(client, baseActivity(), { idempotency_key: key });
    const r2 = await activityCreate(client, { ...baseActivity(), summary: 'Different' }, { idempotency_key: key });
    expect(r1.id).toBe(r2.id);
    const list = await activityList(client, {});
    expect(list.items).toHaveLength(1);
  });

  it('validates entity_type — rejects invalid values', async () => {
    await expect(
      activityCreate(client, { ...baseActivity(), entity_type: 'task' as never }),
    ).rejects.toThrow();
  });
});

describe('activityGet', () => {
  it('returns activity by id', async () => {
    const row = await activityCreate(client, baseActivity());
    const fetched = await activityGet(client, row.id);
    expect(fetched.id).toBe(row.id);
  });

  it('throws NOT_FOUND for soft-deleted activity', async () => {
    const row = await activityCreate(client, baseActivity());
    await activitySoftDelete(client, row.id);
    await expect(activityGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('activitySoftDelete / activityRestore', () => {
  it('soft-deletes then restores', async () => {
    const row = await activityCreate(client, baseActivity());
    await activitySoftDelete(client, row.id);
    await expect(activityGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const restored = await activityRestore(client, row.id);
    expect(restored.deleted_at).toBeNull();
    await expect(activityGet(client, row.id)).resolves.toBeTruthy();
  });
});

describe('activityList', () => {
  it('excludes soft-deleted by default', async () => {
    const row = await activityCreate(client, baseActivity());
    await activitySoftDelete(client, row.id);
    const list = await activityList(client, {});
    expect(list.items).toHaveLength(0);
  });

  it('filters by entity_type and entity_id', async () => {
    await activityCreate(client, baseActivity());
    await activityCreate(client, { ...baseActivity(), entity_type: 'company', entity_id: 'co-1' });
    const list = await activityList(client, { entity_type: 'contact', entity_id: contactId });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.entity_type).toBe('contact');
  });

  it('filters by activity_type', async () => {
    await activityCreate(client, baseActivity());
    await activityCreate(client, { ...baseActivity(), activity_type: 'email', summary: 'Sent email' });
    const list = await activityList(client, { activity_type: 'email' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.activity_type).toBe('email');
  });

  it('paginates with cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await activityCreate(client, { ...baseActivity(), summary: `Activity ${i}` });
    }
    const page1 = await activityList(client, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await activityList(client, { limit: 2, cursor: page1.next_cursor });
    expect(page2.items).toHaveLength(1);
    expect(page2.next_cursor).toBeUndefined();
  });
});
