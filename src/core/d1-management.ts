/**
 * Cloudflare D1 management operations: create, list, get, delete databases.
 * Thin layer over D1Client management endpoints — exported separately so
 * org.ts can import without pulling in query/batch types.
 */

import type { D1Client, D1Database } from './d1-client.js';

export type { D1Database };

export async function createDatabase(client: D1Client, name: string): Promise<D1Database> {
  return client.createDb(name);
}

export async function listDatabases(client: D1Client): Promise<D1Database[]> {
  return client.listDbs();
}

export async function deleteDatabase(client: D1Client, uuid: string): Promise<void> {
  return client.deleteDb(uuid);
}

export async function getDatabase(client: D1Client, uuid: string): Promise<D1Database> {
  const all = await client.listDbs();
  const found = all.find((db) => db.uuid === uuid);
  if (!found) {
    // Import lazily to avoid circular dep
    const { CrmdError, ErrorCode } = await import('./errors.js');
    throw new CrmdError(ErrorCode.NOT_FOUND, `Database "${uuid}" not found`);
  }
  return found;
}
