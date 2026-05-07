/**
 * Shared SQL helpers for CRM CRUD modules.
 * Row mapping, custom_fields serialization, SQLite error classification,
 * and Zod input parsing with INVALID_INPUT error mapping.
 */

import { z } from 'zod';
import { CrmdError, ErrorCode } from '../../errors.js';

// ---------------------------------------------------------------------------
// Zod input parser — maps ZodError → CrmdError(INVALID_INPUT)
// ---------------------------------------------------------------------------

/**
 * Parse input through a Zod schema.
 * On ZodError, throws CrmdError(INVALID_INPUT) with field-level issues attached,
 * so callers get a structured INVALID_INPUT rather than a raw ZodError surfacing
 * as INTERNAL at error boundaries.
 */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    const summary = result.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
    throw new CrmdError(ErrorCode.INVALID_INPUT, `Validation failed: ${summary}`, {
      details: { issues },
    });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Custom fields helpers
// ---------------------------------------------------------------------------

/** Serialize custom_fields object to JSON string for D1 storage. Returns null if undefined. */
export function serializeCustomFields(obj: Record<string, unknown> | undefined | null): string | null {
  if (obj == null) return null;
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    throw new CrmdError(ErrorCode.INVALID_INPUT, 'custom_fields must be a plain object');
  }
  return JSON.stringify(obj);
}

/** Parse custom_fields JSON string from D1 row. Returns undefined if null/undefined. */
export function parseCustomFields(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Parameter helpers
// ---------------------------------------------------------------------------

/** Return value or null for undefined — D1 requires explicit null for nullable cols. */
export function bindOrNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

// ---------------------------------------------------------------------------
// Dynamic UPDATE SET clause builder
// ---------------------------------------------------------------------------

/** Allowed column names per entity — prevents SQL injection via arbitrary keys. */
export type AllowedColumns = readonly string[];

export interface UpdateClauseResult {
  setClause: string;   // e.g. "name = ?, email = ?, updated_at = strftime(...)"
  params: unknown[];
}

/**
 * Build a safe dynamic SET clause from a patch object.
 * Only keys in `allowedColumns` are emitted; others are silently dropped.
 * Always appends `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`.
 * Throws INVALID_INPUT if patch has no valid columns.
 */
export function buildUpdateClause(
  patch: Record<string, unknown>,
  allowedColumns: AllowedColumns,
): UpdateClauseResult {
  const allowed = new Set(allowedColumns);
  const params: unknown[] = [];
  const parts: string[] = [];

  for (const key of allowedColumns) {
    if (!(key in patch)) continue;
    if (!allowed.has(key)) continue;
    parts.push(`${key} = ?`);
    params.push(patch[key] ?? null);
  }

  if (parts.length === 0) {
    throw new CrmdError(ErrorCode.INVALID_INPUT, 'Patch contains no valid updatable fields');
  }

  parts.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  return { setClause: parts.join(', '), params };
}

// ---------------------------------------------------------------------------
// SQLite error mapper
// ---------------------------------------------------------------------------

/**
 * Map a raw SQLite/D1 error to a typed CrmdError.
 * Detects UNIQUE constraint → CONFLICT, FK constraint → INVALID_INPUT.
 */
export function mapSqliteError(err: unknown, context?: string): CrmdError {
  if (err instanceof CrmdError) return err;

  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('unique constraint failed')) {
    return new CrmdError(
      ErrorCode.CONFLICT,
      `Unique constraint violation${context ? ` on ${context}` : ''}: ${msg}`,
      { cause: err },
    );
  }
  if (lower.includes('foreign key constraint failed')) {
    return new CrmdError(
      ErrorCode.INVALID_INPUT,
      `Foreign key constraint violation${context ? ` on ${context}` : ''}: ${msg}`,
      { cause: err },
    );
  }
  if (lower.includes('no such table')) {
    return new CrmdError(ErrorCode.DB_INIT_REQUIRED, `Database not initialized: ${msg}`, { cause: err });
  }

  return new CrmdError(ErrorCode.DB_ERROR, `Database error: ${msg}`, { cause: err });
}

// ---------------------------------------------------------------------------
// Soft-delete filter helper
// ---------------------------------------------------------------------------

/** Append `AND deleted_at IS NULL` to a WHERE clause fragment. */
export function softDeleteFilter(includeDeleted = false): string {
  return includeDeleted ? '' : ' AND deleted_at IS NULL';
}
