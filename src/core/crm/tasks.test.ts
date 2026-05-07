/**
 * Tests for tasks CRUD module including taskComplete helper.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './internal/sqlite-test-adapter.js';
import {
  taskCreate,
  taskGet,
  taskUpdate,
  taskSoftDelete,
  taskRestore,
  taskComplete,
  taskList,
} from './tasks.js';
import type { D1Client } from '../d1-client.js';

let client: D1Client;

beforeEach(() => {
  ({ client } = makeTestDb());
});

const BASE = {
  title: 'Follow up call',
  due_date: '2024-03-15',
};

describe('taskCreate', () => {
  it('creates a task with defaults', async () => {
    const row = await taskCreate(client, BASE);
    expect(row.id).toBeTruthy();
    expect(row.title).toBe('Follow up call');
    expect(row.status).toBe('open');
    expect(row.due_date).toBe('2024-03-15');
    expect(row.deleted_at).toBeNull();
  });

  it('stores custom_fields', async () => {
    const row = await taskCreate(client, { ...BASE, custom_fields: { source: 'crm' } });
    expect(row.custom_fields).toEqual({ source: 'crm' });
  });

  it('validates entity_type required when entity_id provided', async () => {
    await expect(
      taskCreate(client, { ...BASE, entity_id: 'some-id' } as never),
    ).rejects.toThrow();
  });

  it('is idempotent with idempotency_key', async () => {
    const key = 'idem-task-1';
    const r1 = await taskCreate(client, BASE, { idempotency_key: key });
    const r2 = await taskCreate(client, { ...BASE, title: 'Other' }, { idempotency_key: key });
    expect(r1.id).toBe(r2.id);
  });
});

describe('taskGet', () => {
  it('returns task by id', async () => {
    const row = await taskCreate(client, BASE);
    const fetched = await taskGet(client, row.id);
    expect(fetched.id).toBe(row.id);
  });

  it('throws NOT_FOUND for soft-deleted task', async () => {
    const row = await taskCreate(client, BASE);
    await taskSoftDelete(client, row.id);
    await expect(taskGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('taskUpdate', () => {
  it('updates title and priority', async () => {
    const row = await taskCreate(client, BASE);
    const updated = await taskUpdate(client, row.id, { title: 'Send proposal', priority: 'high' });
    expect(updated.title).toBe('Send proposal');
    expect(updated.priority).toBe('high');
  });

  it('throws NOT_FOUND for missing id', async () => {
    await expect(taskUpdate(client, 'ghost', { title: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('taskComplete', () => {
  it('marks task as completed', async () => {
    const row = await taskCreate(client, BASE);
    const completed = await taskComplete(client, row.id, 'user-1');
    expect(completed.status).toBe('completed');
    expect(completed.updated_by).toBe('user-1');
  });
});

describe('taskSoftDelete / taskRestore', () => {
  it('soft-deletes then restores', async () => {
    const row = await taskCreate(client, BASE);
    await taskSoftDelete(client, row.id);
    await expect(taskGet(client, row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const restored = await taskRestore(client, row.id);
    expect(restored.deleted_at).toBeNull();
  });
});

describe('taskList', () => {
  it('excludes soft-deleted by default', async () => {
    const row = await taskCreate(client, BASE);
    await taskSoftDelete(client, row.id);
    const list = await taskList(client, {});
    expect(list.items).toHaveLength(0);
  });

  it('filters by status', async () => {
    const r1 = await taskCreate(client, BASE);
    await taskCreate(client, { ...BASE, title: 'T2' });
    await taskComplete(client, r1.id);
    const list = await taskList(client, { status: 'open' });
    expect(list.items.every((t) => t.status === 'open')).toBe(true);
  });

  it('filters by due_before / due_after', async () => {
    await taskCreate(client, { ...BASE, due_date: '2024-01-01' });
    await taskCreate(client, { ...BASE, title: 'Later task', due_date: '2024-12-31' });
    const list = await taskList(client, { due_before: '2024-06-01' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.due_date).toBe('2024-01-01');
  });

  it('paginates with cursor', async () => {
    for (let i = 0; i < 3; i++) {
      await taskCreate(client, { title: `Task ${i}`, due_date: '2024-05-01' });
    }
    const page1 = await taskList(client, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    const page2 = await taskList(client, { limit: 2, cursor: page1.next_cursor });
    expect(page2.items).toHaveLength(1);
    expect(page2.next_cursor).toBeUndefined();
  });

  it('filters by assignee', async () => {
    await taskCreate(client, { ...BASE, assigned_to: 'user-a' });
    await taskCreate(client, { ...BASE, title: 'T2', assigned_to: 'user-b' });
    const list = await taskList(client, { assignee: 'user-a' });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.assigned_to).toBe('user-a');
  });
});
