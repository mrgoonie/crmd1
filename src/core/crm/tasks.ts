/**
 * CRM tasks CRUD module.
 * Includes completeTask helper for status transition.
 * Soft-delete semantics applied to all read paths.
 */

import { z } from 'zod';
import type { D1Client } from '../d1-client.js';
import { CrmdError, ErrorCode } from '../errors.js';
import { newId } from '../ids.js';
import { CustomFieldsSchema, PaginationSchema } from '../validators.js';
import { encodeCursor, decodeCursor } from './internal/cursor.js';
import { withIdempotency } from './internal/idempotency.js';
import {
  serializeCustomFields,
  parseCustomFields,
  bindOrNull,
  buildUpdateClause,
  mapSqliteError,
  parseInput,
} from './internal/sql.js';

// ---------------------------------------------------------------------------
// Schemas & types
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum(['open', 'in_progress', 'completed', 'cancelled']);
export const TaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

const LINKED_ENTITY_TYPES = ['contact', 'company', 'deal'] as const;
export const TaskEntityTypeSchema = z.enum(LINKED_ENTITY_TYPES);

// Base object (no refine) — used to derive Patch schema
const TaskBaseSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(5000).optional(),
  entity_type: TaskEntityTypeSchema.optional(),
  entity_id: z.string().optional(),
  assigned_to: z.string().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'due_date must be YYYY-MM-DD'),
  status: TaskStatusSchema.optional().default('open'),
  priority: TaskPrioritySchema.optional(),
  custom_fields: CustomFieldsSchema,
  created_by: z.string().optional(),
});

export const TaskInputSchema = TaskBaseSchema.refine(
  (d) => !(d.entity_id && !d.entity_type),
  { message: 'entity_type is required when entity_id is provided', path: ['entity_type'] },
);

export const TaskPatchSchema = TaskBaseSchema
  .partial()
  .omit({ created_by: true })
  .extend({ updated_by: z.string().optional() })
  .refine(
    (d) => !(d.entity_id && !d.entity_type),
    { message: 'entity_type is required when entity_id is provided', path: ['entity_type'] },
  );

export const TaskFiltersSchema = z.object({
  status: TaskStatusSchema.optional(),
  assignee: z.string().optional(),
  entity_type: TaskEntityTypeSchema.optional(),
  entity_id: z.string().optional(),
  due_before: z.string().optional(),
  due_after: z.string().optional(),
  include_deleted: z.boolean().optional().default(false),
});

export const TaskListParamsSchema = PaginationSchema.merge(TaskFiltersSchema);

export type TaskInput = z.input<typeof TaskInputSchema>;
export type TaskPatch = z.input<typeof TaskPatchSchema>;
export type TaskListParams = z.input<typeof TaskListParamsSchema>;

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  assigned_to: string | null;
  due_date: string;
  status: string;
  priority: string | null;
  custom_fields: Record<string, unknown> | undefined;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface TaskListResult {
  items: TaskRow[];
  next_cursor: string | undefined;
  count_estimate: number;
}

// ---------------------------------------------------------------------------
// Allowed patch columns (whitelist)
// ---------------------------------------------------------------------------

const PATCH_COLUMNS = [
  'title', 'description', 'entity_type', 'entity_id', 'assigned_to',
  'due_date', 'status', 'priority', 'custom_fields', 'updated_by',
] as const;

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapRow(raw: Record<string, unknown>): TaskRow {
  return {
    id: raw['id'] as string,
    title: raw['title'] as string,
    description: (raw['description'] as string | null) ?? null,
    entity_type: (raw['entity_type'] as string | null) ?? null,
    entity_id: (raw['entity_id'] as string | null) ?? null,
    assigned_to: (raw['assigned_to'] as string | null) ?? null,
    due_date: raw['due_date'] as string,
    status: raw['status'] as string,
    priority: (raw['priority'] as string | null) ?? null,
    custom_fields: parseCustomFields(raw['custom_fields']),
    created_at: raw['created_at'] as string,
    updated_at: raw['updated_at'] as string,
    deleted_at: (raw['deleted_at'] as string | null) ?? null,
    created_by: (raw['created_by'] as string | null) ?? null,
    updated_by: (raw['updated_by'] as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export async function taskCreate(
  client: D1Client,
  input: TaskInput,
  opts?: { idempotency_key?: string },
): Promise<TaskRow> {
  const data = parseInput(TaskInputSchema, input);
  return withIdempotency(client, 'task.create', opts?.idempotency_key, async () => {
    const id = newId();
    try {
      await client.query(
        `INSERT INTO tasks(id, title, description, entity_type, entity_id, assigned_to, due_date, status, priority, custom_fields, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.title, bindOrNull(data.description), bindOrNull(data.entity_type),
          bindOrNull(data.entity_id), bindOrNull(data.assigned_to), data.due_date,
          data.status, bindOrNull(data.priority),
          serializeCustomFields(data.custom_fields), bindOrNull(data.created_by)],
      );
    } catch (err) { throw mapSqliteError(err, 'tasks'); }
    return taskGet(client, id);
  });
}

export async function taskGet(client: D1Client, id: string): Promise<TaskRow> {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Task not found: ${id}`);
  return mapRow(row);
}

export async function taskUpdate(
  client: D1Client,
  id: string,
  patch: TaskPatch,
): Promise<TaskRow> {
  const data = parseInput(TaskPatchSchema, patch);
  const patchObj: Record<string, unknown> = { ...data };
  if ('custom_fields' in patchObj && patchObj['custom_fields'] !== undefined) {
    patchObj['custom_fields'] = serializeCustomFields(patchObj['custom_fields'] as Record<string, unknown>);
  }
  const { setClause, params } = buildUpdateClause(patchObj, PATCH_COLUMNS);
  try {
    const result = await client.query(
      `UPDATE tasks SET ${setClause} WHERE id = ? AND deleted_at IS NULL`,
      [...params, id],
    );
    if (result.meta.rows_written === 0) {
      throw new CrmdError(ErrorCode.NOT_FOUND, `Task not found: ${id}`);
    }
  } catch (err) {
    if (err instanceof CrmdError) throw err;
    throw mapSqliteError(err, 'tasks');
  }
  return taskGet(client, id);
}

export async function taskSoftDelete(
  client: D1Client,
  id: string,
): Promise<{ id: string; deleted_at: string }> {
  const now = new Date().toISOString();
  const result = await client.query(
    `UPDATE tasks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, [now, id],
  );
  if (result.meta.rows_written === 0) {
    throw new CrmdError(ErrorCode.NOT_FOUND, `Task not found or already deleted: ${id}`);
  }
  return { id, deleted_at: now };
}

export async function taskRestore(client: D1Client, id: string): Promise<TaskRow> {
  await client.query(
    `UPDATE tasks SET deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [id],
  );
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE id = ?`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Task not found: ${id}`);
  return mapRow(row);
}

/** Convenience: mark task as completed and set updated_at. */
export async function taskComplete(
  client: D1Client,
  id: string,
  updatedBy?: string,
): Promise<TaskRow> {
  return taskUpdate(client, id, { status: 'completed', updated_by: updatedBy });
}

export async function taskList(
  client: D1Client,
  params: TaskListParams = {},
): Promise<TaskListResult> {
  const p = parseInput(TaskListParamsSchema, params);
  const { limit, cursor, status, assignee, entity_type, entity_id,
    due_before, due_after, include_deleted } = p;

  const conditions: string[] = ['1=1'];
  const qParams: unknown[] = [];

  if (!include_deleted) conditions.push('deleted_at IS NULL');
  if (status) { conditions.push('status = ?'); qParams.push(status); }
  if (assignee) { conditions.push('assigned_to = ?'); qParams.push(assignee); }
  if (entity_type) { conditions.push('entity_type = ?'); qParams.push(entity_type); }
  if (entity_id) { conditions.push('entity_id = ?'); qParams.push(entity_id); }
  if (due_before) { conditions.push('due_date < ?'); qParams.push(due_before); }
  if (due_after) { conditions.push('due_date > ?'); qParams.push(due_after); }

  if (cursor) {
    const { last_created_at, last_id } = decodeCursor(cursor);
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
    qParams.push(last_created_at, last_created_at, last_id);
  }

  const where = conditions.join(' AND ');
  const fetchLimit = (limit ?? 50) + 1;
  qParams.push(fetchLimit);

  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM tasks WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
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
