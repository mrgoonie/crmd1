/**
 * CRM deals CRUD module.
 * Includes linked_contacts helpers (JSON array stored in TEXT column).
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

export const DealStageSchema = z.enum([
  'prospect', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost',
]);

export const DealInputSchema = z.object({
  title: z.string().min(1).max(255),
  company_id: z.string().uuid(),
  amount: z.number().min(0).optional(),
  stage: DealStageSchema.optional(),
  close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'close_date must be YYYY-MM-DD').optional(),
  probability: z.number().int().min(0).max(100).optional(),
  owner_user_id: z.string().optional(),
  linked_contacts: z.array(z.string().uuid()).optional(),
  notes_summary: z.string().max(5000).optional(),
  custom_fields: CustomFieldsSchema,
  created_by: z.string().optional(),
});

export const DealPatchSchema = DealInputSchema.partial().omit({ created_by: true }).extend({
  updated_by: z.string().optional(),
});

export const DealFiltersSchema = z.object({
  stage: DealStageSchema.optional(),
  contact_id: z.string().optional(),
  company_id: z.string().optional(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  include_deleted: z.boolean().optional().default(false),
});

export const DealListParamsSchema = PaginationSchema.merge(DealFiltersSchema);

export type DealInput = z.input<typeof DealInputSchema>;
export type DealPatch = z.input<typeof DealPatchSchema>;
export type DealListParams = z.input<typeof DealListParamsSchema>;

export interface DealRow {
  id: string;
  title: string;
  company_id: string;
  amount: number | null;
  stage: string | null;
  close_date: string | null;
  probability: number | null;
  owner_user_id: string | null;
  linked_contacts: string[];
  notes_summary: string | null;
  custom_fields: Record<string, unknown> | undefined;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface DealListResult {
  items: DealRow[];
  next_cursor: string | undefined;
  count_estimate: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PATCH_COLUMNS = [
  'title', 'company_id', 'amount', 'stage', 'close_date', 'probability',
  'owner_user_id', 'linked_contacts', 'notes_summary', 'custom_fields', 'updated_by',
] as const;

function serializeLinkedContacts(arr: string[] | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return JSON.stringify(arr);
}

function parseLinkedContacts(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[]).filter((v): v is string => typeof v === 'string');
  } catch { return []; }
}

function mapRow(raw: Record<string, unknown>): DealRow {
  return {
    id: raw['id'] as string,
    title: raw['title'] as string,
    company_id: raw['company_id'] as string,
    amount: (raw['amount'] as number | null) ?? null,
    stage: (raw['stage'] as string | null) ?? null,
    close_date: (raw['close_date'] as string | null) ?? null,
    probability: (raw['probability'] as number | null) ?? null,
    owner_user_id: (raw['owner_user_id'] as string | null) ?? null,
    linked_contacts: parseLinkedContacts(raw['linked_contacts']),
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

export async function dealCreate(
  client: D1Client,
  input: DealInput,
  opts?: { idempotency_key?: string },
): Promise<DealRow> {
  const data = parseInput(DealInputSchema, input);
  return withIdempotency(client, 'deal.create', opts?.idempotency_key, async () => {
    const id = newId();
    try {
      await client.query(
        `INSERT INTO deals(id, title, company_id, amount, stage, close_date, probability, owner_user_id, linked_contacts, notes_summary, custom_fields, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.title, data.company_id, bindOrNull(data.amount), bindOrNull(data.stage),
          bindOrNull(data.close_date), bindOrNull(data.probability), bindOrNull(data.owner_user_id),
          serializeLinkedContacts(data.linked_contacts), bindOrNull(data.notes_summary),
          serializeCustomFields(data.custom_fields), bindOrNull(data.created_by)],
      );
    } catch (err) { throw mapSqliteError(err, 'deals'); }
    return dealGet(client, id);
  });
}

export async function dealGet(client: D1Client, id: string): Promise<DealRow> {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM deals WHERE id = ? AND deleted_at IS NULL`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Deal not found: ${id}`);
  return mapRow(row);
}

export async function dealUpdate(
  client: D1Client,
  id: string,
  patch: DealPatch,
): Promise<DealRow> {
  const data = parseInput(DealPatchSchema, patch);
  const patchObj: Record<string, unknown> = { ...data };
  if ('custom_fields' in patchObj && patchObj['custom_fields'] !== undefined) {
    patchObj['custom_fields'] = serializeCustomFields(patchObj['custom_fields'] as Record<string, unknown>);
  }
  if ('linked_contacts' in patchObj) {
    patchObj['linked_contacts'] = serializeLinkedContacts(patchObj['linked_contacts'] as string[] | undefined);
  }
  const { setClause, params } = buildUpdateClause(patchObj, PATCH_COLUMNS);
  try {
    const result = await client.query(
      `UPDATE deals SET ${setClause} WHERE id = ? AND deleted_at IS NULL`,
      [...params, id],
    );
    if (result.meta.rows_written === 0) {
      throw new CrmdError(ErrorCode.NOT_FOUND, `Deal not found: ${id}`);
    }
  } catch (err) {
    if (err instanceof CrmdError) throw err;
    throw mapSqliteError(err, 'deals');
  }
  return dealGet(client, id);
}

export async function dealSoftDelete(
  client: D1Client,
  id: string,
): Promise<{ id: string; deleted_at: string }> {
  const now = new Date().toISOString();
  const result = await client.query(
    `UPDATE deals SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, [now, id],
  );
  if (result.meta.rows_written === 0) {
    throw new CrmdError(ErrorCode.NOT_FOUND, `Deal not found or already deleted: ${id}`);
  }
  return { id, deleted_at: now };
}

export async function dealRestore(client: D1Client, id: string): Promise<DealRow> {
  await client.query(
    `UPDATE deals SET deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [id],
  );
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM deals WHERE id = ?`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Deal not found: ${id}`);
  return mapRow(row);
}

export async function dealList(
  client: D1Client,
  params: DealListParams = {},
): Promise<DealListResult> {
  const p = parseInput(DealListParamsSchema, params);
  const { limit, cursor, stage, contact_id, company_id, min_amount, max_amount, include_deleted } = p;

  const conditions: string[] = ['1=1'];
  const qParams: unknown[] = [];

  if (!include_deleted) conditions.push('deleted_at IS NULL');
  if (stage) { conditions.push('stage = ?'); qParams.push(stage); }
  if (company_id) { conditions.push('company_id = ?'); qParams.push(company_id); }
  if (min_amount !== undefined) { conditions.push('amount >= ?'); qParams.push(min_amount); }
  if (max_amount !== undefined) { conditions.push('amount <= ?'); qParams.push(max_amount); }
  // contact_id: search inside JSON array using LIKE (acceptable for v1)
  if (contact_id) { conditions.push('linked_contacts LIKE ?'); qParams.push(`%${contact_id}%`); }

  if (cursor) {
    const { last_created_at, last_id } = decodeCursor(cursor);
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
    qParams.push(last_created_at, last_created_at, last_id);
  }

  const where = conditions.join(' AND ');
  const fetchLimit = (limit ?? 50) + 1;
  qParams.push(fetchLimit);

  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM deals WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
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

// ---------------------------------------------------------------------------
// Linked contacts helpers
// ---------------------------------------------------------------------------

/** Add a contact to deal's linked_contacts array (read-modify-write; acceptable race for v1). */
export async function dealAddLinkedContact(
  client: D1Client,
  dealId: string,
  contactId: string,
): Promise<DealRow> {
  const deal = await dealGet(client, dealId);
  if (!deal.linked_contacts.includes(contactId)) {
    await dealUpdate(client, dealId, {
      linked_contacts: [...deal.linked_contacts, contactId],
    });
  }
  return dealGet(client, dealId);
}

/** Remove a contact from deal's linked_contacts array. */
export async function dealRemoveLinkedContact(
  client: D1Client,
  dealId: string,
  contactId: string,
): Promise<DealRow> {
  const deal = await dealGet(client, dealId);
  await dealUpdate(client, dealId, {
    linked_contacts: deal.linked_contacts.filter((id) => id !== contactId),
  });
  return dealGet(client, dealId);
}
