# Phase 04 — Schema, Migrations, DB Init

## Context Links
- `plans/reports/researcher-260508-0025-crm-data-model.md` (full DDL, indexes, FTS5 triggers)
- `docs/system-architecture.md` (data model summary)
- `docs/code-standards.md` (DDL discipline)

## Overview
- **Priority:** P1
- **Status:** complete
- Author canonical schema (5 tables + FTS5 + triggers + indexes). Implement idempotent applier. Set up append-only migrations folder.

## Key Insights
- D1 supports FTS5 via `CREATE VIRTUAL TABLE ... USING fts5(...)`.
- D1 supports triggers; use them to maintain FTS5 + `updated_at`.
- `IF NOT EXISTS` on every CREATE → idempotent re-runs.
- Migrations table records applied filenames; apply only missing.

## Requirements
- `core/schema.sql`: full DDL bundle (also exported as TS string for embedding).
- Tables: contacts, companies, deals, activities, tasks (per data-model report).
- FTS5: `crm_search` covering contacts (name/email/phone/notes_summary), companies (name/domain/notes_summary), activities (summary/metadata).
- Triggers: AI/AU/AD on each base table to maintain `crm_search` and `updated_at`.
- All indexes from data-model report.
- `_migrations` table: `(filename TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)`.
- `db-init.ts`: applies schema + pending migrations; safe to re-run.

## Architecture
```
core/schema.sql                  → canonical DDL (also imported as string)
core/migrations/0001-base.sql    → mirrors schema.sql for first install
core/migrations/index.ts         → imports all .sql files, ordered by name
core/db-init.ts                  → applySchema(d1, dbId): runs base + pending
```

We embed SQL via Vite/tsup `?raw` import or `fs.readFile` at install — simpler: ship as TS string constants generated at build (use a small `scripts/embed-sql.mjs` or just `import sql from './schema.sql?raw'` if tsup supports). Decision: use `tsup`'s loader rule `loader: { '.sql': 'text' }`.

## Related Code Files

### To Create
- `src/core/schema.sql`
- `src/core/migrations/0001-base.sql` (re-exports same DDL; future migrations append)
- `src/core/migrations/index.ts`
- `src/core/db-init.ts`
- `src/core/db-init.test.ts` (better-sqlite3 in-memory)

## Implementation Steps

### schema.sql
1. Paste full DDL from `researcher-260508-0025-crm-data-model.md` §8, with these adjustments:
   - All `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`.
   - All `CREATE INDEX` → `CREATE INDEX IF NOT EXISTS`.
   - Replace single FTS table per entity with one consolidated `crm_search` FTS5 (columns: `entity_type, entity_id, text`) — agents search across all entity types in one query (matches PDR use case 4).
   - Remove `FOREIGN KEY` enforcement clauses (D1 supports but they're soft-defaults; keep declarations for documentation).
   - Add `_migrations(filename TEXT PK, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)`.
   - Add triggers per base table: AI/AU populate `crm_search`; AD removes from FTS; AU updates `updated_at = CURRENT_TIMESTAMP`.

### migrations/0001-base.sql
1. Same content as schema.sql for first-time install. Subsequent migrations are 0002-, 0003-, …

### migrations/index.ts
1. Export ordered array `[{ filename, sql }]`. Use tsup `.sql` text loader. Sort lexicographically.

### db-init.ts
1. `async function applySchema(d1: D1Client, dbId: string): Promise<{ applied: string[] }>`:
   - Ensure `_migrations` exists (single CREATE).
   - SELECT applied filenames.
   - Diff vs `migrations/index` ordered list.
   - For each pending: split by `;` carefully (semicolons inside strings? Use a simple statement splitter — DDL has no string literals with `;`). Run via `d1.batch` (≤1000) in chunks; INSERT into `_migrations` last.
   - Return list of applied filenames.
2. `async function isInitialized(d1, dbId): Promise<boolean>`: probe `_migrations` exists.
3. Wire into `org.orgCreate` as the `applySchema` callback.

## Todo List
- [x] schema.sql with all CREATE IF NOT EXISTS + triggers + crm_search FTS5
- [x] migrations/0001-base.sql
- [x] migrations/index.ts (text loader)
- [x] db-init.ts: apply pending, idempotent
- [x] tsup config: no .sql loader needed — embedded as TS string constant
- [x] tests: in-memory better-sqlite3, run twice, assert no errors second pass
- [x] tests: insert contact → verify FTS5 row appears via trigger

## Success Criteria
- Re-running `applySchema` is a no-op after first run.
- Triggers populate `crm_search` automatically.
- Better-sqlite3 in-memory accepts the same SQL (subset compatibility).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| FTS5 trigger syntax differs in better-sqlite3 vs D1 | Low | Medium | Test in both; FTS5 stable since SQLite 3.9. |
| Naive `;` splitter breaks on multi-statement DDL with embedded semicolons | Low | High | Constrain DDL to no `;` inside strings; document rule; add splitter unit test. |
| Migrations run partially → inconsistent state | Medium | High | Wrap each migration's statements in a `BEGIN; ... COMMIT;` batch; D1 supports transactions in `/batch`. |
| FTS5 storage growth | Low | Low | Document `INSERT INTO crm_search('optimize')` as periodic op. |

## Security
- DDL contains no secrets. Migrations in repo are reviewable.

## Next Steps
- Phase 05 builds CRUD on top of this schema.
