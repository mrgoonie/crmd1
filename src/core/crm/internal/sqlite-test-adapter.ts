/**
 * In-memory SQLite adapter that mimics the D1Client interface for tests.
 * Reuses the pattern from db-init.test.ts — kept here as a shared test utility
 * so all CRM test files can import it without duplicating the adapter code.
 *
 * NOTE: This file is test-only. Do not import from production code.
 */

import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../schema.js';
import type { D1Client, D1Statement, D1QueryResult } from '../../d1-client.js';

/** Build a D1Client-compatible adapter backed by an in-memory better-sqlite3 database. */
export function makeSqliteClient(db: Database.Database): D1Client {
  function runQuery<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): D1QueryResult<T> {
    const prepared = db.prepare(sql);
    const trimmed = sql.trimStart().toUpperCase();
    if (
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('WITH') ||
      trimmed.startsWith('PRAGMA')
    ) {
      const rows = prepared.all(...((params ?? []) as unknown[])) as T[];
      return { results: rows, meta: { rows_read: rows.length, rows_written: 0, duration: 0 } };
    }
    const info = prepared.run(...((params ?? []) as unknown[]));
    return {
      results: [],
      meta: { rows_read: 0, rows_written: info.changes, duration: 0 },
    };
  }

  function runBatch(stmts: D1Statement[]): D1QueryResult[] {
    return stmts.map((stmt) => {
      const hasParams = (stmt.params?.length ?? 0) > 0;
      if (!hasParams) {
        db.exec(stmt.sql);
        return { results: [], meta: { rows_read: 0, rows_written: 0, duration: 0 } };
      }
      return runQuery(stmt.sql, stmt.params);
    });
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

/** Create a fresh in-memory database with the full schema applied. */
export function makeTestDb(): { db: Database.Database; client: D1Client } {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  const client = makeSqliteClient(db);
  return { db, client };
}
