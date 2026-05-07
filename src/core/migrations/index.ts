/**
 * Ordered migration registry.
 * Each entry: { filename, sql }.
 * SQL is embedded as a string constant — no .sql text loader needed in tsup.
 * New migrations: append entries in lexicographic order (0002-*, 0003-*, …).
 */

import { SCHEMA_SQL } from '../schema.js';

export interface Migration {
  filename: string;
  sql: string;
}

/**
 * All known migrations in apply order.
 * 0001-base mirrors schema.sql for first-time installs.
 * The _migrations table itself is created by db-init before these run,
 * so it is safe to reference here without bootstrapping concerns.
 */
export const MIGRATIONS: Migration[] = [
  {
    filename: '0001-base.sql',
    // Reuse the embedded schema constant — single source of truth.
    sql: SCHEMA_SQL,
  },
];
