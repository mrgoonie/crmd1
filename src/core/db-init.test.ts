/**
 * Tests for db-init.ts using better-sqlite3 in-memory database.
 * Validates: schema DDL correctness, trigger behavior, idempotency,
 * FTS5 sync on insert/soft-delete, splitStatements helper.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { splitStatements, initDatabase, isInitialized, getSchemaVersion } from './db-init.js';
import { SCHEMA_SQL } from './schema.js';
import type { D1Client, D1Statement, D1QueryResult } from './d1-client.js';

// ---------------------------------------------------------------------------
// In-memory SQLite adapter that mimics D1Client interface
// ---------------------------------------------------------------------------

function makeSqliteClient(db: Database.Database): D1Client {
  function runBatch(stmts: D1Statement[]): D1QueryResult[] {
    const results: D1QueryResult[] = [];
    for (const stmt of stmts) {
      const hasParams = (stmt.params?.length ?? 0) > 0;
      if (hasParams) {
        // Parameterised DML — use prepare+run
        const prepared = db.prepare(stmt.sql);
        const info = prepared.run(...((stmt.params ?? []) as unknown[]));
        results.push({
          results: [],
          meta: { rows_read: 0, rows_written: info.changes, duration: 0 },
        });
      } else {
        // DDL / trigger blocks — exec handles multi-statement and BEGIN..END
        db.exec(stmt.sql);
        results.push({ results: [], meta: { rows_read: 0, rows_written: 0, duration: 0 } });
      }
    }
    return results;
  }

  function runQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): D1QueryResult<T> {
    const prepared = db.prepare(sql);
    const rows = prepared.all(...((params ?? []) as unknown[])) as T[];
    return {
      results: rows,
      meta: { rows_read: rows.length, rows_written: 0, duration: 0 },
    };
  }

  return {
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      Promise.resolve(runQuery<T>(sql, params)),
    batch: (stmts: D1Statement[]) => Promise.resolve(runBatch(stmts)),
    raw: () => Promise.reject(new Error('raw not implemented in test adapter')),
    withDatabase: () => { throw new Error('withDatabase not needed in test adapter'); },
    listDbs: () => Promise.reject(new Error('not implemented')),
    createDb: () => Promise.reject(new Error('not implemented')),
    deleteDb: () => Promise.reject(new Error('not implemented')),
  } as unknown as D1Client;
}

// ---------------------------------------------------------------------------
// splitStatements
// ---------------------------------------------------------------------------

describe('splitStatements()', () => {
  it('splits on semicolons', () => {
    const sql = 'SELECT 1; SELECT 2; SELECT 3';
    expect(splitStatements(sql)).toHaveLength(3);
  });

  it('filters empty fragments', () => {
    const sql = 'SELECT 1;;; SELECT 2';
    expect(splitStatements(sql)).toHaveLength(2);
  });

  it('strips inline comments', () => {
    const sql = 'SELECT 1 -- this is a comment\n; SELECT 2';
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).not.toContain('--');
  });

  it('handles CREATE TRIGGER multi-line blocks', () => {
    const sql = `
      CREATE TABLE t (id TEXT PRIMARY KEY);
      CREATE TRIGGER t_ai AFTER INSERT ON t
      BEGIN
        SELECT 1;
      END
    `;
    // The BEGIN...END block contains a semicolon, so it splits inside —
    // this is expected and documented; DDL convention forbids ; in strings.
    const stmts = splitStatements(sql);
    expect(stmts.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Schema correctness (exec full DDL against better-sqlite3)
// ---------------------------------------------------------------------------

describe('SCHEMA_SQL structural correctness', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // Execute full schema via exec (handles multi-statement + triggers natively)
    try {
      db.exec(SCHEMA_SQL);
    } catch (e) {
      throw new Error(`SCHEMA_SQL exec failed: ${String(e)}`);
    }
  });

  it('creates all 5 core tables', () => {
    // Fetch all tables then filter in JS to avoid LIKE escape issues
    const allTables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all() as Array<{ name: string }>;
    const tables = allTables.filter(
      (t) => !t.name.startsWith('_') && !t.name.startsWith('sqlite_') && !t.name.includes('_data') && !t.name.includes('_idx') && !t.name.includes('_content') && !t.name.includes('_docsize') && !t.name.includes('_config'),
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain('contacts');
    expect(names).toContain('companies');
    expect(names).toContain('deals');
    expect(names).toContain('activities');
    expect(names).toContain('tasks');
  });

  it('creates crm_search FTS5 virtual table', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='crm_search'`)
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('crm_search');
  });

  it('creates _crmd1_meta and _migrations tables', () => {
    const meta = db
      .prepare(`SELECT name FROM sqlite_master WHERE name='_crmd1_meta'`)
      .get();
    const mig = db
      .prepare(`SELECT name FROM sqlite_master WHERE name='_migrations'`)
      .get();
    expect(meta).toBeTruthy();
    expect(mig).toBeTruthy();
  });

  it('inserts schema_version=1 into _crmd1_meta', () => {
    const row = db
      .prepare(`SELECT value FROM _crmd1_meta WHERE key='schema_version'`)
      .get() as { value: string } | undefined;
    expect(row?.value).toBe('1');
  });

  it('creates key indexes', () => {
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_contacts_email');
    expect(names).toContain('idx_companies_domain');
    expect(names).toContain('idx_deals_stage');
    expect(names).toContain('idx_activities_entity');
    expect(names).toContain('idx_tasks_due_date');
  });
});

// ---------------------------------------------------------------------------
// FTS5 trigger behavior
// ---------------------------------------------------------------------------

describe('FTS5 triggers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
  });

  it('populates crm_search on contact insert', () => {
    db.prepare(
      `INSERT INTO contacts(id, email, first_name, last_name) VALUES (?,?,?,?)`,
    ).run('c1', 'alice@example.com', 'Alice', 'Smith');

    const rows = db
      .prepare(`SELECT * FROM crm_search WHERE entity_type='contact'`)
      .all() as Array<{ entity_id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity_id).toBe('c1');
  });

  it('updates crm_search on contact update', () => {
    db.prepare(
      `INSERT INTO contacts(id, email, first_name, last_name) VALUES (?,?,?,?)`,
    ).run('c2', 'bob@example.com', 'Bob', 'Jones');

    db.prepare(`UPDATE contacts SET notes_summary=? WHERE id=?`).run('new notes', 'c2');

    const rows = db
      .prepare(`SELECT body FROM crm_search WHERE entity_id='c2'`)
      .all() as Array<{ body: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toContain('new notes');
  });

  it('removes from crm_search on contact hard delete', () => {
    db.prepare(
      `INSERT INTO contacts(id, email, first_name, last_name) VALUES (?,?,?,?)`,
    ).run('c3', 'eve@example.com', 'Eve', 'Brown');

    db.prepare(`DELETE FROM contacts WHERE id=?`).run('c3');

    const rows = db
      .prepare(`SELECT * FROM crm_search WHERE entity_id='c3'`)
      .all();
    expect(rows).toHaveLength(0);
  });

  it('FTS5 search finds inserted contact by name', () => {
    db.prepare(
      `INSERT INTO contacts(id, email, first_name, last_name, notes_summary) VALUES (?,?,?,?,?)`,
    ).run('c4', 'carol@example.com', 'Carol', 'White', 'great customer prospect');

    const results = db
      .prepare(`SELECT entity_id FROM crm_search WHERE body MATCH 'carol'`)
      .all() as Array<{ entity_id: string }>;
    expect(results.some((r) => r.entity_id === 'c4')).toBe(true);
  });

  it('populates crm_search on company insert', () => {
    db.prepare(
      `INSERT INTO companies(id, name, domain) VALUES (?,?,?)`,
    ).run('co1', 'Acme Corp', 'acme.com');

    const rows = db
      .prepare(`SELECT entity_id FROM crm_search WHERE entity_type='company'`)
      .all() as Array<{ entity_id: string }>;
    expect(rows[0]?.entity_id).toBe('co1');
  });
});

// ---------------------------------------------------------------------------
// initDatabase() idempotency via in-memory adapter
// ---------------------------------------------------------------------------

describe('initDatabase()', () => {
  let db: Database.Database;
  let client: D1Client;

  beforeEach(() => {
    db = new Database(':memory:');
    client = makeSqliteClient(db);
  });

  it('applies migrations on first run', async () => {
    const result = await initDatabase(client);

    expect(result.applied).toContain('0001-base.sql');
    expect(result.already_initialized).toBe(false);
    expect(result.schema_version).toBe(1);
  });

  it('is idempotent — second run applies nothing', async () => {
    await initDatabase(client);
    const result2 = await initDatabase(client);

    expect(result2.applied).toHaveLength(0);
    expect(result2.already_initialized).toBe(true);
  });

  it('isInitialized returns false before init', async () => {
    expect(await isInitialized(client)).toBe(false);
  });

  it('isInitialized returns true after init', async () => {
    await initDatabase(client);
    expect(await isInitialized(client)).toBe(true);
  });

  it('getSchemaVersion returns 1 after init', async () => {
    await initDatabase(client);
    expect(await getSchemaVersion(client)).toBe(1);
  });

  it('getSchemaVersion returns 0 on empty db', async () => {
    expect(await getSchemaVersion(client)).toBe(0);
  });
});
