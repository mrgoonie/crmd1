/**
 * CRM full-text search module using FTS5 crm_search virtual table.
 * Sanitizes user query, runs MATCH, then hydrates source rows from base tables.
 */

import { z } from 'zod';
import type { D1Client } from '../d1-client.js';
import { CrmdError, ErrorCode } from '../errors.js';
import { encodeCursor, decodeCursor } from './internal/cursor.js';
import { parseInput } from './internal/sql.js';

// ---------------------------------------------------------------------------
// FTS5-indexed entity types (per schema triggers)
// ---------------------------------------------------------------------------

export const SEARCH_ENTITY_TYPES = ['contact', 'company', 'deal', 'activity', 'task'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SearchParamsSchema = z.object({
  q: z.string().min(1).max(500),
  types: z.array(z.enum(SEARCH_ENTITY_TYPES)).optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
});

export type SearchParams = z.input<typeof SearchParamsSchema>;

export interface SearchHit {
  entity_type: SearchEntityType;
  entity_id: string;
  snippet: string;
  rank: number;
}

export interface SearchResult {
  items: SearchHit[];
  next_cursor: string | undefined;
}

// ---------------------------------------------------------------------------
// FTS5 query sanitizer
// ---------------------------------------------------------------------------

/**
 * Sanitize a user-supplied FTS5 query string.
 * Wraps the whole query in double-quotes for phrase search,
 * but if the user uses FTS5 operators (AND/OR/NOT/NEAR) we pass through with minimal escaping.
 * Always escapes internal double-quotes.
 */
export function sanitizeFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new CrmdError(ErrorCode.INVALID_INPUT, 'Search query cannot be empty');

  // Detect if user is using FTS5 operators
  const hasFtsOperators = /\b(AND|OR|NOT|NEAR)\b/.test(trimmed);

  // Escape internal double-quotes in both cases
  const escaped = trimmed.replace(/"/g, '""');

  if (hasFtsOperators) {
    // Pass through with escaped quotes — user knows what they're doing
    return escaped;
  }

  // Phrase search: wrap entire query in double-quotes
  return `"${escaped}"`;
}

// ---------------------------------------------------------------------------
// Search operation
// ---------------------------------------------------------------------------

export async function crmSearch(
  client: D1Client,
  params: SearchParams,
): Promise<SearchResult> {
  const p = parseInput(SearchParamsSchema, params);
  const { q, types, limit, cursor } = p;

  const ftsQuery = sanitizeFtsQuery(q);
  const effectiveTypes = types && types.length > 0 ? types : [...SEARCH_ENTITY_TYPES];

  const qParams: unknown[] = [ftsQuery];
  let entityFilter = '';
  if (effectiveTypes.length < SEARCH_ENTITY_TYPES.length) {
    const placeholders = effectiveTypes.map(() => '?').join(', ');
    entityFilter = ` AND entity_type IN (${placeholders})`;
    qParams.push(...effectiveTypes);
  }

  // Cursor for FTS is offset-based (rank ordering is stable for a given query)
  let offsetVal = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    // We repurpose last_id to store the numeric offset
    const parsed = parseInt(decoded.last_id, 10);
    if (!isNaN(parsed)) offsetVal = parsed;
  }

  const fetchLimit = (limit ?? 50) + 1;
  qParams.push(fetchLimit, offsetVal);

  const sql = `
    SELECT entity_type, entity_id,
           snippet(crm_search, 2, '<b>', '</b>', '...', 10) AS snippet,
           rank
    FROM crm_search
    WHERE crm_search MATCH ?${entityFilter}
    ORDER BY rank
    LIMIT ? OFFSET ?
  `;

  let rows: Array<{ entity_type: string; entity_id: string; snippet: string; rank: number }>;
  try {
    const result = await client.query<{
      entity_type: string;
      entity_id: string;
      snippet: string;
      rank: number;
    }>(sql, qParams);
    rows = result.results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CrmdError(ErrorCode.DB_ERROR, `FTS5 search failed: ${msg}`, { cause: err });
  }

  const hasMore = rows.length === fetchLimit;
  if (hasMore) rows.pop();

  const items: SearchHit[] = rows.map((r) => ({
    entity_type: r.entity_type as SearchEntityType,
    entity_id: r.entity_id,
    snippet: r.snippet ?? '',
    rank: r.rank,
  }));

  const nextOffset = offsetVal + items.length;
  const next_cursor = hasMore
    ? encodeCursor({ last_created_at: new Date().toISOString(), last_id: String(nextOffset) })
    : undefined;

  return { items, next_cursor };
}
