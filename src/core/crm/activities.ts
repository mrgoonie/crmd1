/**
 * CRM activities CRUD module.
 * Activities are append-only: no update operation.
 * Soft-delete semantics applied to read paths.
 */

import { z } from 'zod';
import type { D1Client } from '../d1-client.js';
import { CrmdError, ErrorCode } from '../errors.js';
import { newId } from '../ids.js';
import { PaginationSchema } from '../validators.js';
import { encodeCursor, decodeCursor } from './internal/cursor.js';
import { withIdempotency } from './internal/idempotency.js';
import { bindOrNull, mapSqliteError, parseInput } from './internal/sql.js';

// ---------------------------------------------------------------------------
// Schemas & types
// ---------------------------------------------------------------------------

export const ActivityTypeSchema = z.enum([
  'call', 'email', 'meeting', 'note', 'task_completed', 'demo', 'follow_up', 'other',
]);

const LINKED_ENTITY_TYPES = ['contact', 'company', 'deal'] as const;
export const ActivityEntityTypeSchema = z.enum(LINKED_ENTITY_TYPES);

export const ActivityInputSchema = z.object({
  entity_type: ActivityEntityTypeSchema,
  entity_id: z.string().min(1),
  activity_type: ActivityTypeSchema,
  summary: z.string().min(1).max(5000),
  metadata: z.record(z.string(), z.unknown()).optional(),
  next_follow_up_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'next_follow_up_date must be YYYY-MM-DD')
    .optional(),
  created_by: z.string().optional(),
});

export const ActivityFiltersSchema = z.object({
  entity_type: ActivityEntityTypeSchema.optional(),
  entity_id: z.string().optional(),
  activity_type: ActivityTypeSchema.optional(),
  include_deleted: z.boolean().optional().default(false),
});

export const ActivityListParamsSchema = PaginationSchema.merge(ActivityFiltersSchema);

export type ActivityInput = z.input<typeof ActivityInputSchema>;
export type ActivityListParams = z.input<typeof ActivityListParamsSchema>;

export interface ActivityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  activity_type: string;
  summary: string;
  metadata: Record<string, unknown> | undefined;
  next_follow_up_date: string | null;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
}

export interface ActivityListResult {
  items: ActivityRow[];
  next_cursor: string | undefined;
  count_estimate: number;
}

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function parseMetadata(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch { return undefined; }
}

function mapRow(raw: Record<string, unknown>): ActivityRow {
  return {
    id: raw['id'] as string,
    entity_type: raw['entity_type'] as string,
    entity_id: raw['entity_id'] as string,
    activity_type: raw['activity_type'] as string,
    summary: raw['summary'] as string,
    metadata: parseMetadata(raw['metadata']),
    next_follow_up_date: (raw['next_follow_up_date'] as string | null) ?? null,
    created_at: raw['created_at'] as string,
    created_by: (raw['created_by'] as string | null) ?? null,
    deleted_at: (raw['deleted_at'] as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Operations (no update — activities are immutable)
// ---------------------------------------------------------------------------

export async function activityCreate(
  client: D1Client,
  input: ActivityInput,
  opts?: { idempotency_key?: string },
): Promise<ActivityRow> {
  const data = parseInput(ActivityInputSchema, input);
  return withIdempotency(client, 'activity.create', opts?.idempotency_key, async () => {
    const id = newId();
    const metadataJson = data.metadata ? JSON.stringify(data.metadata) : null;
    try {
      await client.query(
        `INSERT INTO activities(id, entity_type, entity_id, activity_type, summary, metadata, next_follow_up_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.entity_type, data.entity_id, data.activity_type, data.summary,
          metadataJson, bindOrNull(data.next_follow_up_date), bindOrNull(data.created_by)],
      );
    } catch (err) { throw mapSqliteError(err, 'activities'); }
    return activityGet(client, id);
  });
}

export async function activityGet(client: D1Client, id: string): Promise<ActivityRow> {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM activities WHERE id = ? AND deleted_at IS NULL`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Activity not found: ${id}`);
  return mapRow(row);
}

export async function activitySoftDelete(
  client: D1Client,
  id: string,
): Promise<{ id: string; deleted_at: string }> {
  const now = new Date().toISOString();
  const result = await client.query(
    `UPDATE activities SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, [now, id],
  );
  if (result.meta.rows_written === 0) {
    throw new CrmdError(ErrorCode.NOT_FOUND, `Activity not found or already deleted: ${id}`);
  }
  return { id, deleted_at: now };
}

export async function activityRestore(client: D1Client, id: string): Promise<ActivityRow> {
  await client.query(
    `UPDATE activities SET deleted_at = NULL WHERE id = ?`, [id],
  );
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM activities WHERE id = ?`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Activity not found: ${id}`);
  return mapRow(row);
}

export async function activityList(
  client: D1Client,
  params: ActivityListParams = {},
): Promise<ActivityListResult> {
  const p = parseInput(ActivityListParamsSchema, params);
  const { limit, cursor, entity_type, entity_id, activity_type, include_deleted } = p;

  const conditions: string[] = ['1=1'];
  const qParams: unknown[] = [];

  if (!include_deleted) conditions.push('deleted_at IS NULL');
  if (entity_type) { conditions.push('entity_type = ?'); qParams.push(entity_type); }
  if (entity_id) { conditions.push('entity_id = ?'); qParams.push(entity_id); }
  if (activity_type) { conditions.push('activity_type = ?'); qParams.push(activity_type); }

  if (cursor) {
    const { last_created_at, last_id } = decodeCursor(cursor);
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
    qParams.push(last_created_at, last_created_at, last_id);
  }

  const where = conditions.join(' AND ');
  const fetchLimit = (limit ?? 50) + 1;
  qParams.push(fetchLimit);

  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM activities WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
    qParams,
  );
  const rows = result.results.map(mapRow);
  const hasMore = rows.length === fetchLimit;
  if (hasMore) rows.pop();

  const last = rows[rows.length - 1];
  const next_cursor = hasMore && last
    ? encodeCursor({ last_created_at: last.created_at, last_id: last.id })
    : undefined;

  return { items: rows, next_cursor, count_estimate: rows.length + (hasMore ? 1 : 0) };
}
