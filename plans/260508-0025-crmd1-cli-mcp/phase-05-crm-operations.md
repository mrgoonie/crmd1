# Phase 05 — CRM Operations

## Context Links
- `plans/reports/researcher-260508-0025-crm-data-model.md` (entity fields)
- `plans/reports/researcher-260508-0025-agent-cli-mcp-patterns.md` (cursor pagination, idempotency)
- `docs/system-architecture.md` (output contract)

## Overview
- **Priority:** P1
- **Status:** complete
- Build CRUD + search per entity. Pure functions taking `(d1, dbId, input)` — no globals, easy to test, reused by CLI + MCP.

## Key Insights
- All reads filter `deleted_at IS NULL` unless `includeDeleted=true`.
- Cursor: opaque base64 of `{last_created_at, last_id}` for stable pagination across mutations.
- Idempotency: hash of `(operation, idempotency_key)` stored in lightweight `_idempotency(key, response_json, created_at)` table; 24h TTL on read. Add to schema (phase 04 update — capture as concern).
- Custom fields: stored as JSON TEXT; validated as object on input; round-tripped via `JSON.stringify`/`parse`.
- Email/domain uniqueness: enforced by index; CONFLICT on collision → map to `CONFLICT` code.

## Requirements
- For each of contacts, companies, deals, activities, tasks:
  - `create(input, opts?)` — returns full row.
  - `get(id)` — throw `NOT_FOUND` if missing or soft-deleted.
  - `update(id, patch)` — partial update; bumps `updated_at`.
  - `softDelete(id)` — sets `deleted_at`.
  - `restore(id)` — clears `deleted_at`.
  - `list({ limit, cursor, filters? })` — returns `{ items, next_cursor, count_estimate }`.
- `search.ts`: `crmSearch({ q, entity_types?, limit, cursor })` over `crm_search` FTS5 + structured filter merge.
- Idempotency wrapper: `withIdempotency(key, op)` — checks `_idempotency`, replays prior response if present.

## Architecture
```
core/crm/
  contacts.ts    → create/get/update/softDelete/restore/list
  companies.ts   → same shape
  deals.ts       → same + linked_contacts JSON helpers
  activities.ts  → create/get/list (no update — append-only) + softDelete
  tasks.ts       → same as contacts plus completeTask helper
  search.ts      → FTS5 query + filter
  internal/
    cursor.ts    → encode/decode { last_created_at, last_id }
    idempotency.ts → checkAndStore wrapper
    sql.ts       → shared row-mapper, parameter binders, custom_fields json round-trip
```

Each entity file ≤ 200 LOC. Shared SQL helpers extracted into `internal/sql.ts` to satisfy DRY.

## Related Code Files

### To Create
- `src/core/crm/contacts.ts` (+ test)
- `src/core/crm/companies.ts` (+ test)
- `src/core/crm/deals.ts` (+ test)
- `src/core/crm/activities.ts` (+ test)
- `src/core/crm/tasks.ts` (+ test)
- `src/core/crm/search.ts` (+ test)
- `src/core/crm/internal/cursor.ts` (+ test)
- `src/core/crm/internal/idempotency.ts` (+ test)
- `src/core/crm/internal/sql.ts` (+ test)

### To Modify
- `src/core/migrations/0001-base.sql` — add `_idempotency` table.
- `src/core/validators.ts` — confirm Patch schemas exist.

## Implementation Steps

### internal/sql.ts
1. `bindOrNull(value)` — helper returning `null` for undefined.
2. `mapRow<T>(row, schema)` — zod-validate raw D1 row, parse `custom_fields` JSON.
3. `serializeCustomFields(obj?)` — JSON.stringify; null on undefined.
4. `now()` — ISO timestamp string for explicit set.

### internal/cursor.ts
1. `encodeCursor({ last_created_at, last_id })` → base64url.
2. `decodeCursor(s)` → object or throw `INVALID_INPUT`.
3. Test round-trip + invalid base64.

### internal/idempotency.ts
1. `withIdempotency(d1, dbId, key | undefined, op): Promise<Result>`:
   - If no key → just run op.
   - SELECT response_json from `_idempotency` WHERE key=?; if found and < 24h → JSON.parse and return.
   - Run op; INSERT key + serialized result.
   - On conflict (concurrent), select winner.

### contacts.ts
1. `contactCreate(d1, dbId, input, opts?)`: validate via `ContactInput`, generate id, INSERT (parameterized), wrap in idempotency. Return full row via SELECT by id.
2. `contactGet(d1, dbId, id)`: SELECT WHERE id=? AND deleted_at IS NULL. NOT_FOUND if empty.
3. `contactUpdate(d1, dbId, id, patch)`: build dynamic SET clause from non-undefined patch keys; bind params in order; UPDATE; throw NOT_FOUND if 0 rows. Email collision → CONFLICT.
4. `contactSoftDelete(d1, dbId, id)`: UPDATE SET deleted_at=now WHERE id=? AND deleted_at IS NULL.
5. `contactRestore(d1, dbId, id)`: UPDATE SET deleted_at=NULL WHERE id=?.
6. `contactList(d1, dbId, { limit=50, cursor?, status?, company_id? })`: build SELECT with filters; ORDER BY created_at DESC, id DESC; LIMIT limit+1 to detect more; if cursor, add `(created_at, id) < (?, ?)`.

### companies.ts / deals.ts / activities.ts / tasks.ts
Same pattern. Activities: no update method, only append + soft delete; immutability per data-model report. Deals: helpers `dealAddLinkedContact(id, contactId)`, `dealRemoveLinkedContact(id, contactId)` mutating JSON array atomically (read-modify-write inside `withIdempotency`; document race window as acceptable for v1).

### search.ts
1. `crmSearch(d1, dbId, { q, entity_types?, limit=50, cursor? })`:
   - Sanitize FTS5 query: escape `"`; reject control chars.
   - Build `SELECT entity_type, entity_id, snippet(crm_search,...) FROM crm_search WHERE crm_search MATCH ? [AND entity_type IN (...)] ORDER BY rank LIMIT ?`.
   - Hydrate hits by joining back to base tables (one query per entity type using `IN (...)`).
   - Return `{ items: [{ entity_type, entity_id, snippet, entity }], next_cursor }`.

## Todo List
- [x] _idempotency table added to schema.ts (already present from Phase 04)
- [x] internal/cursor.ts + tests
- [x] internal/idempotency.ts + tests
- [x] internal/sql.ts + tests
- [x] contacts.ts CRUD + list cursor + tests
- [x] companies.ts + tests
- [x] deals.ts + linked_contacts helpers + tests
- [x] activities.ts (no update) + tests
- [x] tasks.ts + completeTask + tests
- [x] search.ts FTS5 + hydration + tests

## Success Criteria
- `pnpm test` core/crm green; coverage ≥70%.
- Cursor pagination stable under concurrent inserts (test simulates).
- Idempotent retry returns identical payload.
- FTS5 search finds contact by partial email + company by domain.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| FTS5 special chars (`-`, `*`, `:`) corrupt query | High | Medium | Wrap user input in double quotes; escape internal quotes. |
| Custom_fields JSON injection via crafted strings | Low | Low | We always JSON.stringify on write; never concat. |
| Race on dealLinkedContacts read-modify-write | Medium | Low | Document; revisit if v2 needs CAS. |
| Dynamic UPDATE SET clause SQL build | Medium | High | Whitelist column names from zod schema keys; never accept arbitrary keys. |
| Idempotency table grows unbounded | Low | Low | Add hint to README about periodic prune; out of scope v1. |

## Security
- No raw SQL from user input. Whitelist column names in update builders.
- FTS5 query string treated as untrusted; quoted before MATCH.

## Next Steps
- Phase 06 wires CLI commands to these functions.
- Phase 07 wires MCP tools to the same functions.
