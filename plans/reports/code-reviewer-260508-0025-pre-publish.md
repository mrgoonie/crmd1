# Pre-publish Review — crmd1 v0.1.0

Scope: src/core, src/cli, src/mcp, src/bin, root config. ~5.9k LOC.

## Critical

### C1. MCP server: package.json path resolution will break when published
- **Path:** `src/mcp/server.ts:25-34`
- **Issue:** `readVersion()` reads `join(__dir, '../../package.json')`. For dist layout `<pkg>/dist/mcp.js`, `__dir = <pkg>/dist`, so the resolved path is `<pkg>/../package.json` — outside the installed package. When end users `npx crmd1-mcp`, the catch returns `'0.0.0'`. Also dead code: tsup already injects `__PKG_VERSION__` (used in cli/index.ts).
- **Fix:** Replace with the same `declare const __PKG_VERSION__` pattern used in `src/cli/index.ts:23` and remove `readFileSync` + `fileURLToPath` imports. Single source of truth.

### C2. Zod validation errors surface as INTERNAL, not INVALID_INPUT
- **Path:** all `src/core/crm/*.ts` (e.g. `contacts.ts:127`, `companies.ts:117`, `deals.ts:142`, `tasks.ts:142`, `activities.ts:109`); `src/core/errors.ts:91-108` `serializeError`.
- **Issue:** `XxxInputSchema.parse(input)` throws `ZodError` (subclass of `Error`). `serializeError` falls through to `code: ErrorCode.INTERNAL, retryable: false`, with the raw Zod multi-line message. AI agents and CLI users get an opaque INTERNAL where the operation is actually retryable-after-fix INVALID_INPUT. Loses field-level error detail too.
- **Fix:** In `serializeError` (and ideally a top-level wrapper in core CRUD funcs), detect `ZodError` and map to `CrmdError(INVALID_INPUT, msg, { details: { issues: e.issues } })`. Or wrap each `Schema.parse(...)` call site.

## High

### H1. Soft-deleted records remain in FTS5 search results
- **Path:** `src/core/schema.ts:104-273` (FTS triggers); `src/core/crm/search.ts:106-114`.
- **Issue:** Soft-delete sets `deleted_at` via UPDATE, which fires the `*_fts_au` UPDATE trigger that re-inserts the search body. Search query has no `deleted_at` filter and no JOIN to source tables. Soft-deleted entities are returned by `crm_search`.
- **Fix options:** (a) make `*_fts_au` trigger DELETE-only when `NEW.deleted_at IS NOT NULL`; (b) JOIN search hits to source tables and filter; or (c) hydrate hits in search.ts and drop deleted ones. Prefer (a) — keeps FTS index small.

### H2. Idempotency keys are not scoped per operation
- **Path:** `src/core/crm/internal/idempotency.ts:24-75`.
- **Issue:** Key alone is the dedup unit. If two different operations (e.g. `contact_create` then `company_create`) reuse the same `idempotency_key` (a likely AI-agent footgun), the second replays the first's response, producing wrong-shaped data. Tool descriptions warn "unique key" but offer no guard.
- **Fix:** Compose the storage key as `${operation}:${key}` (operation = "contact.create", "deal.create", …). Cheap and prevents cross-tool collision.

### H3. ESM module uses `require()`
- **Path:** `src/cli/index.ts:97`.
- **Issue:** `const { printErr } = require('./output.js')` inside an ESM bundle. tsup shims `require` (`shims: true`) so it usually works, but it's flaky when `parseAsync` rejects in race with module init. Also `printErr` is already imported elsewhere — no need for dynamic require.
- **Fix:** Add `import { printErr } from './output.js'` at top of file and use directly.

### H4. Idempotency table grows unbounded
- **Path:** `src/core/crm/internal/idempotency.ts`.
- **Issue:** Stale entries are only purged on miss for the same key. Long-lived DBs accumulate rows forever (each row stores full response JSON).
- **Fix:** Periodic cleanup via `db_init` running `DELETE FROM _crmd1_idempotency WHERE created_at < datetime('now','-1 day')`, or a TTL index check at write time keyed by hourly bucket. Track as follow-up; not a blocker for first release if low-volume.

## Medium

### M1. `splitStatements` BEGIN/END regex lacks word boundaries
- **Path:** `src/core/db-init.ts:50` `tokenRe = /BEGIN|END|;/gi`.
- **Issue:** Will mis-tokenise identifiers containing `END` (e.g. `LEGEND`, `APPEND`). Current schema is safe, but future migrations could hit it silently.
- **Fix:** `/\b(BEGIN|END)\b|;/gi`.

### M2. Deal `contact_id` filter via `LIKE %uuid%`
- **Path:** `src/core/crm/deals.ts:240`.
- **Issue:** Substring match across a JSON array. Code comment acknowledges. UUID v7 collision over 36 chars is improbable but not impossible across serialized arrays. Tracked.
- **Fix (later):** normalise to a `deal_contacts` join table, or use `json_each` + `EXISTS`.

### M3. CLI `db query` writes warning to stderr but routes through error path on multi-stmt rejection
- **Path:** `src/cli/commands/db.ts:53-59`.
- **Issue:** `printErr` is called with a plain `Object.assign(new Error(...), { code })` — `serializeError` doesn't recognise it as `CrmdError`, falls through to `INTERNAL` (exit 1), not `INVALID_INPUT` (exit 5). User-facing exit-code spec is wrong.
- **Fix:** Throw `new CrmdError(ErrorCode.INVALID_INPUT, ...)` instead.

### M4. `cli/index.ts` global flag state across imports
- **Path:** `src/cli/runtime.ts:18`, `src/cli/output.ts:12`.
- **Issue:** Module-level mutable state for `_globalFlags` / `_jsonMode`. Works fine for CLI but hostile to testing; tests must reset between cases. Low priority for v0.1.
- **Fix (later):** pass a `Context` object through commander action callbacks.

### M5. File-size — split candidates per `code-standards.md` (>200 LOC)
- `src/core/d1-client.ts` (355): split helpers (`validateStatement`, `mapHttpError`, `parseRetryAfter`) into `d1-http.ts`.
- `src/core/crm/deals.ts` (298), `tasks.ts` (273), `contacts.ts` (246), `companies.ts` (236): consider extracting per-entity row mappers into a sibling `*-mapper.ts` if you grow more entities. Not blocking.
- `src/core/schema.ts` (308): exempt — pure SQL string constant.

## Low / Nit

### L1. `withIdempotency` re-read after INSERT compares JSON strings
- **Path:** `src/core/crm/internal/idempotency.ts:66`.
- Works because `JSON.stringify` is deterministic for same input shape, but fragile under future schema drift. Consider deep-equal or skip the comparison and always return stored row when conflict detected.

### L2. `process.env.CRMD1_LOG` mutated by CLI preAction
- **Path:** `src/cli/index.ts:90-91`.
- Fine, but `core/logger.ts:11` re-reads env on every `write()` — acceptable but wasteful. Cache once.

### L3. Search cursor is offset-based
- **Path:** `src/core/crm/search.ts:95-101,140-143`.
- Non-stable across data changes (documented as acceptable for v1). Good as-is for now.

### L4. `getAuth` calls `loadConfig()` twice when both token + account_id come from config
- **Path:** `src/core/config.ts:124-132`.
- Two separate `await loadConfig()` calls — minor I/O waste. Cache the result.

### L5. `org-tools.ts:147-150` duplicates fail-path logic
- The `crm_search` tool has its own `CrmdError` instanceof branch, while the shared `fail()` already does the same. Dead branch.

### L6. CLI commands ignore `--idempotency-key` on update commands
- `src/cli/commands/contact.ts:98,111`, `deal.ts:101,113`. Update flow doesn't accept opts for idempotency. Minor — schema doesn't currently expose it on patch.

## Boundary discipline ✅
- core/ has zero imports from cli/ or mcp/ (verified via grep).
- cli/ has zero imports from mcp/ and vice versa.

## Security ✅
- All SQL parameterised; dynamic SET clause whitelisted via `PATCH_COLUMNS` (`src/core/crm/internal/sql.ts:69`).
- FTS5 query sanitised (`search.ts:53`).
- Token only logged via `redactToken` (last-4 only).
- Config file written atomically with `0600` perms on POSIX (`config.ts:89-95`).
- MCP path: no `console.log` / `process.stdout.write` in `src/mcp/**` or `src/core/**` — clean.
- `db_query` MCP escape hatch enforces parameter binding.

## Dependency hygiene ✅
- 5 runtime deps, all justified. No unused. `better-sqlite3` properly in `devDependencies` (test adapter only).

## Positive observations
- Excellent error-code taxonomy with retryable flag.
- Tool descriptions are clear, include examples — well-tuned for AI agents.
- Idempotency on all create paths.
- Soft-delete consistently filtered on read paths in CRUD modules (only FTS misses it — see H1).
- Atomic config file writes with mode 0600.
- Cursor pagination is keyset-based for entity lists (stable).
- Schema rollback on `createOrg` failure (org.ts:122-138).

## Recommended actions (ordered)
1. Fix C1 (MCP version path) — one-line change, ships broken otherwise.
2. Fix C2 (Zod → INVALID_INPUT) — wrap `serializeError` to recognise ZodError.
3. Fix H1 (FTS soft-delete) — UPDATE trigger should DELETE when `NEW.deleted_at IS NOT NULL`.
4. Fix H2 (idempotency key scoping) — prefix with operation name.
5. Fix H3, M3 (small).
6. Track H4, M1, M2, M5 as follow-ups.

## Unresolved questions
- Should `crm_search` results include soft-deleted hits when caller passes `include_deleted: true`? Currently the tool has no such flag.
- Should `deal_update` accept `idempotency_key`? Pattern is inconsistent (only `*_create` paths take it).
- Is `_crmd1_idempotency` cleanup strategy (H4) on the v0.2 roadmap or do we want it in v0.1?

**Status:** DONE_WITH_CONCERNS
**Score:** 8.7/10
**Critical count:** 2
**Summary:** Two must-fix blockers (broken MCP version path; Zod errors masquerading as INTERNAL) plus one high-impact correctness bug (soft-deleted records leak via FTS search). Codebase is otherwise well-structured, security-clean, and AI-agent-friendly.
