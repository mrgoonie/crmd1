/**
 * CRM companies CRUD module.
 * Soft-delete semantics: list/get exclude deleted rows by default.
 */

import { z } from 'zod';
import type { D1Client } from '../d1-client.js';
import { CrmdError, ErrorCode } from '../errors.js';
import { newId } from '../ids.js';
import { DomainSchema, CustomFieldsSchema, PaginationSchema } from '../validators.js';
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

export const CompanyStatusSchema = z.enum(['active', 'inactive', 'prospect', 'churned']);

export const CompanyInputSchema = z.object({
  name: z.string().min(1).max(255),
  domain: DomainSchema.optional(),
  industry: z.string().max(255).optional(),
  employee_count: z.number().int().min(0).optional(),
  status: CompanyStatusSchema.optional().default('active'),
  notes_summary: z.string().max(5000).optional(),
  custom_fields: CustomFieldsSchema,
  created_by: z.string().optional(),
});

export const CompanyPatchSchema = CompanyInputSchema.partial().omit({ created_by: true }).extend({
  updated_by: z.string().optional(),
});

export const CompanyFiltersSchema = z.object({
  domain: z.string().optional(),
  status: CompanyStatusSchema.optional(),
  q: z.string().optional(),
  include_deleted: z.boolean().optional().default(false),
});

export const CompanyListParamsSchema = PaginationSchema.merge(CompanyFiltersSchema);

export type CompanyInput = z.input<typeof CompanyInputSchema>;
export type CompanyPatch = z.input<typeof CompanyPatchSchema>;
export type CompanyListParams = z.input<typeof CompanyListParamsSchema>;

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employee_count: number | null;
  status: string;
  notes_summary: string | null;
  custom_fields: Record<string, unknown> | undefined;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface CompanyListResult {
  items: CompanyRow[];
  next_cursor: string | undefined;
  count_estimate: number;
}

// ---------------------------------------------------------------------------
// Allowed patch columns (whitelist)
// ---------------------------------------------------------------------------

const PATCH_COLUMNS = [
  'name', 'domain', 'industry', 'employee_count',
  'status', 'notes_summary', 'custom_fields', 'updated_by',
] as const;

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function mapRow(raw: Record<string, unknown>): CompanyRow {
  return {
    id: raw['id'] as string,
    name: raw['name'] as string,
    domain: (raw['domain'] as string | null) ?? null,
    industry: (raw['industry'] as string | null) ?? null,
    employee_count: (raw['employee_count'] as number | null) ?? null,
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

export async function companyCreate(
  client: D1Client,
  input: CompanyInput,
  opts?: { idempotency_key?: string },
): Promise<CompanyRow> {
  const data = parseInput(CompanyInputSchema, input);
  return withIdempotency(client, 'company.create', opts?.idempotency_key, async () => {
    const id = newId();
    try {
      await client.query(
        `INSERT INTO companies(id, name, domain, industry, employee_count, status, notes_summary, custom_fields, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, data.name, bindOrNull(data.domain), bindOrNull(data.industry),
          bindOrNull(data.employee_count), data.status, bindOrNull(data.notes_summary),
          serializeCustomFields(data.custom_fields), bindOrNull(data.created_by)],
      );
    } catch (err) { throw mapSqliteError(err, 'companies'); }
    return companyGet(client, id);
  });
}

export async function companyGet(client: D1Client, id: string): Promise<CompanyRow> {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Company not found: ${id}`);
  return mapRow(row);
}

export async function companyUpdate(
  client: D1Client,
  id: string,
  patch: CompanyPatch,
): Promise<CompanyRow> {
  const data = parseInput(CompanyPatchSchema, patch);
  const patchObj: Record<string, unknown> = { ...data };
  if ('custom_fields' in patchObj && patchObj['custom_fields'] !== undefined) {
    patchObj['custom_fields'] = serializeCustomFields(patchObj['custom_fields'] as Record<string, unknown>);
  }
  const { setClause, params } = buildUpdateClause(patchObj, PATCH_COLUMNS);
  try {
    const result = await client.query(
      `UPDATE companies SET ${setClause} WHERE id = ? AND deleted_at IS NULL`,
      [...params, id],
    );
    if (result.meta.rows_written === 0) {
      throw new CrmdError(ErrorCode.NOT_FOUND, `Company not found: ${id}`);
    }
  } catch (err) {
    if (err instanceof CrmdError) throw err;
    throw mapSqliteError(err, 'companies');
  }
  return companyGet(client, id);
}

export async function companySoftDelete(
  client: D1Client,
  id: string,
): Promise<{ id: string; deleted_at: string }> {
  const now = new Date().toISOString();
  const result = await client.query(
    `UPDATE companies SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
    [now, id],
  );
  if (result.meta.rows_written === 0) {
    throw new CrmdError(ErrorCode.NOT_FOUND, `Company not found or already deleted: ${id}`);
  }
  return { id, deleted_at: now };
}

export async function companyRestore(client: D1Client, id: string): Promise<CompanyRow> {
  await client.query(
    `UPDATE companies SET deleted_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [id],
  );
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM companies WHERE id = ?`, [id],
  );
  const row = result.results[0];
  if (!row) throw new CrmdError(ErrorCode.NOT_FOUND, `Company not found: ${id}`);
  return mapRow(row);
}

export async function companyList(
  client: D1Client,
  params: CompanyListParams = {},
): Promise<CompanyListResult> {
  const p = parseInput(CompanyListParamsSchema, params);
  const { limit, cursor, domain, status, q, include_deleted } = p;

  const conditions: string[] = ['1=1'];
  const qParams: unknown[] = [];

  if (!include_deleted) conditions.push('deleted_at IS NULL');
  if (domain) { conditions.push('domain = ?'); qParams.push(domain); }
  if (status) { conditions.push('status = ?'); qParams.push(status); }
  if (q) { conditions.push('(name LIKE ? OR domain LIKE ? OR industry LIKE ?)');
    const like = `%${q}%`; qParams.push(like, like, like); }

  if (cursor) {
    const { last_created_at, last_id } = decodeCursor(cursor);
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
    qParams.push(last_created_at, last_created_at, last_id);
  }

  const where = conditions.join(' AND ');
  const fetchLimit = (limit ?? 50) + 1;
  qParams.push(fetchLimit);

  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM companies WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
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
