/**
 * Idempotent database initializer.
 * Applies pending migrations via D1Client.batch(), tracks applied files
 * in _migrations table. Safe to re-run — already-applied migrations are skipped.
 */

import type { D1Client, D1Statement } from './d1-client.js';
import { CrmdError, ErrorCode } from './errors.js';
import { logger } from './logger.js';
import { MIGRATIONS } from './migrations/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitResult {
  already_initialized: boolean;
  schema_version: number;
  applied: string[];
}

// ---------------------------------------------------------------------------
// SQL statement splitter
// ---------------------------------------------------------------------------

/**
 * Split a SQL string into individual statements.
 * Respects BEGIN...END blocks (used in triggers) — semicolons inside them
 * do NOT terminate the statement. Strips -- line comments.
 *
 * Algorithm: scan char-by-char tracking BEGIN depth.
 * A `;` at depth 0 ends a statement; inside BEGIN...END it does not.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let depth = 0; // nesting depth of BEGIN...END blocks

  // Strip -- comments first to simplify parsing
  const stripped = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');

  // Tokenise: we only need to detect the keywords BEGIN and END and `;`
  // Use a simple regex-based token scan over whitespace-delimited words + semicolons
  const tokenRe = /BEGIN|END|;/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(stripped)) !== null) {
    const token = match[0].toUpperCase();
    if (token === 'BEGIN') {
      depth++;
    } else if (token === 'END') {
      if (depth > 0) depth--;
    } else if (token === ';' && depth === 0) {
      // Statement boundary
      current += stripped.slice(lastIndex, match.index);
      lastIndex = match.index + 1;
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }
    // accumulate text up to and including this token
    current += stripped.slice(lastIndex, match.index + match[0].length);
    lastIndex = match.index + match[0].length;
  }

  // Trailing content after last `;`
  current += stripped.slice(lastIndex);
  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);

  return statements;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Check whether _migrations table exists (proxy for "DB is initialized").
 */
export async function isInitialized(client: D1Client): Promise<boolean> {
  try {
    const { results } = await client.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`,
    );
    return results.length > 0;
  } catch {
    return false;
  }
}

/**
 * Read schema_version from _crmd1_meta. Returns 0 if table/row missing.
 */
export async function getSchemaVersion(client: D1Client): Promise<number> {
  try {
    const { results } = await client.query<{ value: string }>(
      `SELECT value FROM _crmd1_meta WHERE key = 'schema_version'`,
    );
    const row = results[0];
    if (!row) return 0;
    const v = parseInt(row.value, 10);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Apply all pending migrations idempotently.
 *
 * Flow:
 *  1. Ensure _migrations bootstrap table exists (single CREATE IF NOT EXISTS).
 *  2. Read already-applied filenames.
 *  3. For each pending migration: split SQL into statements, batch-execute,
 *     then record in _migrations.
 *  4. Return summary.
 */
export async function initDatabase(client: D1Client): Promise<InitResult> {
  // Bootstrap: ensure _migrations table exists before we can query it.
  await client.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS _migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
    },
  ]);

  // Read already-applied filenames
  const { results: appliedRows } = await client.query<{ filename: string }>(
    `SELECT filename FROM _migrations ORDER BY filename`,
  );
  const appliedSet = new Set(appliedRows.map((r) => r.filename));

  const alreadyInitialized = appliedSet.size > 0;
  const pending = MIGRATIONS.filter((m) => !appliedSet.has(m.filename));

  if (pending.length === 0) {
    const version = await getSchemaVersion(client);
    logger.debug('DB already initialized, no pending migrations', { version });
    return { already_initialized: alreadyInitialized, schema_version: version, applied: [] };
  }

  const applied: string[] = [];

  for (const migration of pending) {
    logger.info('Applying migration', { filename: migration.filename });

    const stmts = splitStatements(migration.sql);
    if (stmts.length === 0) {
      logger.warn('Migration has no statements, skipping', { filename: migration.filename });
      continue;
    }

    // Build batch: all DDL statements + record in _migrations
    const batch: D1Statement[] = [
      ...stmts.map((sql) => ({ sql })),
      {
        sql: `INSERT OR IGNORE INTO _migrations(filename) VALUES (?)`,
        params: [migration.filename],
      },
    ];

    // D1 batch limit is 1000; split if DDL is unusually large
    const CHUNK = 900;
    for (let i = 0; i < batch.length; i += CHUNK) {
      const chunk = batch.slice(i, i + CHUNK);
      // Ensure the _migrations INSERT is only in the last chunk
      if (i + CHUNK < batch.length) {
        // Non-final chunk: exclude trailing INSERT if it slipped in
        await client.batch(chunk.filter((s) => !s.sql.startsWith('INSERT OR IGNORE INTO _migrations')));
      } else {
        await client.batch(chunk);
      }
    }

    applied.push(migration.filename);
    logger.info('Migration applied', { filename: migration.filename });
  }

  const version = await getSchemaVersion(client);
  return { already_initialized: alreadyInitialized, schema_version: version, applied };
}

/**
 * Convenience: throws DB_INIT_REQUIRED if DB has not been initialized.
 * Call from CRUD operations to give a clear error before attempting queries.
 */
export async function requireInitialized(client: D1Client): Promise<void> {
  const ready = await isInitialized(client);
  if (!ready) {
    throw new CrmdError(
      ErrorCode.DB_INIT_REQUIRED,
      'Database schema not applied. Run: crmd1 db init',
    );
  }
}
