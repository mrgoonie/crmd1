/**
 * Tests for CRM FTS5 search module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './internal/sqlite-test-adapter.js';
import { crmSearch, sanitizeFtsQuery } from './search.js';
import { contactCreate, contactSoftDelete, contactRestore } from './contacts.js';
import { companyCreate } from './companies.js';
import type { D1Client } from '../d1-client.js';

let client: D1Client;

beforeEach(async () => {
  ({ client } = makeTestDb());
});

describe('sanitizeFtsQuery', () => {
  it('wraps plain query in double quotes', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('"hello world"');
  });

  it('escapes internal double quotes', () => {
    expect(sanitizeFtsQuery('say "hello"')).toBe('"say ""hello"""');
  });

  it('passes through FTS5 operator queries without wrapping', () => {
    const q = 'alice AND bob';
    expect(sanitizeFtsQuery(q)).toBe('alice AND bob');
  });

  it('throws INVALID_INPUT on empty query', () => {
    expect(() => sanitizeFtsQuery('   ')).toThrow();
  });
});

describe('crmSearch', () => {
  it('finds contact by first name', async () => {
    await contactCreate(client, {
      email: 'carol@example.com', first_name: 'Carol', last_name: 'White',
    });
    const result = await crmSearch(client, { q: 'Carol' });
    expect(result.items.some((h) => h.entity_type === 'contact')).toBe(true);
  });

  it('finds company by domain keyword', async () => {
    await companyCreate(client, { name: 'Globex Corporation', domain: 'globex.com' });
    const result = await crmSearch(client, { q: 'Globex' });
    expect(result.items.some((h) => h.entity_type === 'company')).toBe(true);
  });

  it('filters by entity types', async () => {
    await contactCreate(client, {
      email: 'dave@example.com', first_name: 'Dave', last_name: 'Jones',
    });
    await companyCreate(client, { name: 'Dave Corp', domain: 'davecorp.com' });

    const result = await crmSearch(client, { q: 'Dave', types: ['contact'] });
    expect(result.items.every((h) => h.entity_type === 'contact')).toBe(true);
  });

  it('returns empty items for no match', async () => {
    const result = await crmSearch(client, { q: 'zzznomatch' });
    expect(result.items).toHaveLength(0);
    expect(result.next_cursor).toBeUndefined();
  });

  it('paginates with cursor', async () => {
    // Insert multiple contacts matching "prospect"
    for (let i = 0; i < 3; i++) {
      await contactCreate(client, {
        email: `prospect${i}@example.com`,
        first_name: 'Prospect',
        last_name: `User${i}`,
        notes_summary: 'prospect lead',
      });
    }
    const page1 = await crmSearch(client, { q: 'prospect', limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await crmSearch(client, { q: 'prospect', limit: 2, cursor: page1.next_cursor });
    expect(page2.items).toHaveLength(1);
    expect(page2.next_cursor).toBeUndefined();
  });

  it('each hit has entity_type, entity_id, snippet fields', async () => {
    await contactCreate(client, {
      email: 'snippet@example.com', first_name: 'Snippet', last_name: 'Test',
    });
    const result = await crmSearch(client, { q: 'Snippet' });
    expect(result.items.length).toBeGreaterThan(0);
    const hit = result.items[0]!;
    expect(hit.entity_type).toBeTruthy();
    expect(hit.entity_id).toBeTruthy();
    expect(typeof hit.snippet).toBe('string');
  });

  it('soft-deleted contact is removed from FTS and restored contact reappears', async () => {
    // 1. Create a contact with unique searchable text
    const contact = await contactCreate(client, {
      email: 'fts-softdel@example.com',
      first_name: 'Uniquetracker',
      last_name: 'FtsSoftDel',
    });

    // 2. Confirm it shows up in search
    const before = await crmSearch(client, { q: 'Uniquetracker' });
    expect(before.items.some((h) => h.entity_id === contact.id)).toBe(true);

    // 3. Soft-delete the contact
    await contactSoftDelete(client, contact.id);

    // 4. Confirm it does NOT show up in search
    const afterDelete = await crmSearch(client, { q: 'Uniquetracker' });
    expect(afterDelete.items.some((h) => h.entity_id === contact.id)).toBe(false);

    // 5. Restore the contact
    await contactRestore(client, contact.id);

    // 6. Confirm it shows up again
    const afterRestore = await crmSearch(client, { q: 'Uniquetracker' });
    expect(afterRestore.items.some((h) => h.entity_id === contact.id)).toBe(true);
  });
});
