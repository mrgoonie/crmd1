/**
 * Idempotency wrapper for CRM mutating operations.
 * Stores operation results in _crmd1_idempotency keyed by caller-supplied key.
 * Replays prior response within 24h TTL to ensure at-most-once semantics.
 */

import type { D1Client } from '../../d1-client.js';
import { CrmdError, ErrorCode } from '../../errors.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface IdempotencyRow {
  key: string;
  response: string;
  created_at: string;
}

/**
 * Wrap a mutating operation with idempotency.
 * If key is undefined, the operation runs directly.
 * If key was seen within 24h for the same operation, the prior response is returned.
 * Otherwise, op() is executed and the result stored.
 *
 * The storage key is scoped as `${op}:${key}` to prevent cross-operation collisions
 * (e.g. same idempotency_key used for contact.create and deal.create).
 */
export async function withIdempotency<T>(
  client: D1Client,
  op: string,
  key: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key) return fn();

  // Scope the stored key to the operation to prevent cross-operation replays
  const scopedKey = `${op}:${key}`;

  // Check for existing response
  const existing = await client.query<IdempotencyRow>(
    `SELECT key, response, created_at FROM _crmd1_idempotency WHERE key = ?`,
    [scopedKey],
  );

  const row = existing.results[0];
  if (row) {
    const age = Date.now() - new Date(row.created_at).getTime();
    if (age < TTL_MS) {
      try {
        return JSON.parse(row.response) as T;
      } catch {
        throw new CrmdError(ErrorCode.INTERNAL, 'Idempotency response corrupted');
      }
    }
    // Expired — delete stale entry and proceed
    await client.query(`DELETE FROM _crmd1_idempotency WHERE key = ?`, [scopedKey]);
  }

  const result = await fn();

  const serialized = JSON.stringify(result);
  // INSERT OR IGNORE: if concurrent request already stored it, silently skip
  await client.query(
    `INSERT OR IGNORE INTO _crmd1_idempotency(key, response) VALUES (?, ?)`,
    [scopedKey, serialized],
  );

  // Re-read in case a concurrent request won the INSERT
  const stored = await client.query<IdempotencyRow>(
    `SELECT response FROM _crmd1_idempotency WHERE key = ?`,
    [scopedKey],
  );
  const storedRow = stored.results[0];
  if (storedRow && storedRow.response !== serialized) {
    try {
      return JSON.parse(storedRow.response) as T;
    } catch {
      throw new CrmdError(ErrorCode.INTERNAL, 'Idempotency concurrent response corrupted');
    }
  }

  return result;
}
