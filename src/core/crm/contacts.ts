/**
 * CRM contacts CRUD module.
 * All operations accept a D1Client already bound to the org database.
 * Soft-delete semantics: list/get exclude deleted_at IS NOT NULL by default.
 */

import { z } from 'zod';
import type { D1Client } from '../d1-client.js';
import { CrmdError, ErrorCode } from '../errors.js';
import { newId } from '../ids.js';
import { EmailSchema, CustomFieldsSchema, PaginationSchema } from '../validators.js';
import { encodeCursor, decodeCursor } from './internal/cursor.js';
import { withIdempotency } from './internal/idempotency.js';
import {
  serializeCustomFields,
  parseCustomFields,
  bindOrNull,
  buildUpdateClause,
  mapSqliteError,
  softDeleteFilter,
  parseInput,
} from './internal/sql.js';

// ---------------------------------------------------------------------------
// Schemas & types
// ---------------------------------------------------------------------------

export const ContactStatusSchema = z.enum(['prospect', 'active', 'inactive', 'churned']);

export const ContactInputSchema = z.object({
  email: EmailSchema,
  first_name: z.string().min(1).max(255),
  last_name: z.string().min(1).max(255),
  phone: z.string().max(50).optional(),
  job_title: z.string().max(255).optional(),
  company_id: z.string().uuid().optional(),
  status: ContactStatusSchema.optional().default('prospect'),
  notes_summary: z.string().max(5000).optional(),
  custom_fields: CustomFieldsSchema,
  created_by: z.string().optional(),
});

export const ContactPatchSchema = ContactInputSchema.partial().omit({ created_by: true }).extend({
  updated_by: z.string().optional(),
});

export const ContactFiltersSchema = z.object({
  company_id: z.string().optional(),
  email: z.string().optional(),
  status: ContactStatusSchema.optional(),
  q: z.string().optional(),
  include_deleted: z.boolean().optional().default(false),
});

export const ContactListParamsSchema = PaginationSchema.merge(ContactFiltersSchema);

export type ContactInput = z.input<typeof ContactInputSchema>;
export type ContactPatch = z.input<typeof ContactPatchSchema>;
export type ContactFilters = z.input<typeof ContactFiltersSchema>;
export type ContactListParams = z.input<typeof ContactListParamsSchema>;

export interface ContactRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  job_title: string | null;
  company_id: string | null;
  status: string;
  notes_summary: string | null;
  custom_fields: Record<string, unknown> | undefined;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface ContactListResult {
  items: ContactRow[];
  next_cursor: string | undefined;
  count_estimate: number;
}

// ---------------------------------------------------------------------------
// Allowed patch columns (whitelist prevents SQL injection)
// ---------------------------------------------------------------------------

const PATCH_COLUMNS = [
  'email', 'first_name', 'last_name', 'phone', 'job_title',
  'company_id', 'status', 'notes_summary', 'custom_fields', 'updated_by',
] as const;

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapRow(raw: Record<string, unknown>): ContactRow {
  return {
    id: raw['id'] as string,
    email: raw['email'] as string,
    first_name: raw['first_name'] as string,
    last_name: raw['last_name'] as string,
    phone: (raw['phone'] as string | null) ?? null,
    job_title: (raw['job_title'] as string | null) ?? null,
    company_id: (raw['company_id'] as string | null) ?? null,
    status: raw['status'] as string,
    notes_summary: (raw['notes_summary'] as string | null) ?? null,
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

export async function contactCreate(
  client: D1Client,
  input: ContactInput,
  opts?: { idempotency_key?: string },
): Promise<ContactRow> {
  const data = parseInput(ContactInputSchema, input);
  return withIdempotency(client, 'contact.create', opts?.idempotency_key, async () => {
    const id = newId();
    try {
      await client.query(
        `INSERT INTO contacts(id, email, first_name, last_name, phone, job_title, company_id, status, notes_summary, custom_fields, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.email, data.first_name, data.last_name,
          bindOrNull(data.phone), bindOrNull(data.job_title), bindOrNull(data.company_id),
          data.status, bindOrNull(data.notes_summary),
          serializeCustomFields(data.custom_fields), bindOrNull(data.created_by)],
      );
    } catch (err) { throw mapSqliteError(err, 'contacts'); }
    return contactGet(client, id);
  });
}

export async function contactGet(client: D1Client, id: string): Promise<ContactRow> {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM contacts WHERE id = ? AND deleted_at IS NULL`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Contact not found: ${id}`);
  return mapRow(row);
}

export async function contactUpdate(
  client: D1Client,
  id: string,
  patch: ContactPatch,
): Promise<ContactRow> {
  const data = parseInput(ContactPatchSchema, patch);
  const patchObj: Record<string, unknown> = { ...data };
  if ('custom_fields' in patchObj && patchObj['custom_fields'] !== undefined) {
    patchObj['custom_fields'] = serializeCustomFields(patchObj['custom_fields'] as Record<string, unknown>);
  }
  const { setClause, params } = buildUpdateClause(patchObj, PATCH_COLUMNS);
  try {
    const result = await client.query(
      `UPDATE contacts SET ${setClause} WHERE id = ? AND deleted_at IS NULL`,
      [...params, id],
    );
    if (result.meta.rows_written === 0) {
      throw new CrmdError(ErrorCode.NOT_FOUND, `Contact not found: ${id}`);
    }
  } catch (err) {
    if (err instanceof CrmdError) throw err;
    throw mapSqliteError(err, 'contacts');
  }
  return contactGet(client, id);
}

export async function contactSoftDelete(
  client: D1Client,
  id: string,
): Promise<{ id: string; deleted_at: string }> {
  const now = new Date().toISOString();
  const result = await client.query(
    `UPDATE contacts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
    [now, id],
  );
  if (result.meta.rows_written === 0) {
    throw new CrmdError(ErrorCode.NOT_FOUND, `Contact not found or already deleted: ${id}`);
  }
  return { id, deleted_at: now };
}

export async function contactRestore(client: D1Client, id: string): Promise<ContactRow> {
  await client.query(
    `UPDATE contacts SET deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [id],
  );
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM contacts WHERE id = ?`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Contact not found: ${id}`);
  return mapRow(row);
}

export async function contactList(
  client: D1Client,
  params: ContactListParams = {},
): Promise<ContactListResult> {
  const p = parseInput(ContactListParamsSchema, params);
  const { limit, cursor, company_id, email, status, q, include_deleted } = p;

  const conditions: string[] = ['1=1'];
  const qParams: unknown[] = [];

  if (!include_deleted) conditions.push('deleted_at IS NULL');
  if (company_id) { conditions.push('company_id = ?'); qParams.push(company_id); }
  if (email) { conditions.push('email = ?'); qParams.push(email); }
  if (status) { conditions.push('status = ?'); qParams.push(status); }
  if (q) { conditions.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)');
    const like = `%${q}%`; qParams.push(like, like, like); }

  if (cursor) {
    const { last_created_at, last_id } = decodeCursor(cursor);
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
    qParams.push(last_created_at, last_created_at, last_id);
  }

  const where = conditions.join(' AND ');
  const fetchLimit = (limit ?? 50) + 1;
  const sql = `SELECT * FROM contacts WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`;
  qParams.push(fetchLimit);

  const result = await client.query<Record<string, unknown>>(sql, qParams);
  const rows = result.results.map(mapRow);
  const hasMore = rows.length === fetchLimit;
  if (hasMore) rows.pop();

  const last = rows[rows.length - 1];
  const next_cursor = hasMore && last
    ? encodeCursor({ last_created_at: last.created_at, last_id: last.id })
    : undefined;

  return { items: rows, next_cursor, count_estimate: rows.length + (hasMore ? 1 : 0) };
}
