# Phase 03 — D1 Client + Org Management

## Context Links
- `plans/reports/researcher-260508-0025-cloudflare-d1-access.md` (REST endpoints, auth, limits)
- `docs/system-architecture.md` (D1 access, error codes)

## Overview
- **Priority:** P1
- **Status:** complete
- Thin REST wrapper around Cloudflare D1 (query/raw/batch) and Cloudflare D1 management (create/list/delete DB). No ORM, no Wrangler dep.

## Key Insights
- D1 limits: 30s timeout, 100KB statement, 100 params, batch ≤1000 (Paid) / 50 (Free).
- `/query` returns `{ result: [{ success, meta, results }], success, errors }`.
- `/raw` returns columnar arrays (faster). `/batch` runs many in one request.
- Mgmt API: `POST /accounts/{id}/d1/database` (body `{name}`) returns `{ uuid, name, ... }`.
- Errors: 401/403 → `AUTH_INVALID`; 404 → `NOT_FOUND`/`ORG_NOT_FOUND`; 429 → `RATE_LIMIT` with `retry-after`; 5xx → `DB_ERROR`.

## Requirements
- `D1Client` class: takes `{ token, accountId }`. Methods `query`, `raw`, `batch`, `listDbs`, `createDb`, `deleteDb`.
- All methods accept abort signal; default 30s timeout.
- Map HTTP status + Cloudflare `errors[]` to `CrmdError`.
- Org module: persists slug→{database_id,name,created_at} into config.
- `org create <slug>`: provisions DB via mgmt API, applies schema (delegated to phase 04), persists mapping.
- `org list`: from config (no network).
- `org use <slug>`: sets `active_org`.
- `org delete <slug>`: deletes DB via mgmt API, removes mapping. Confirmation guard at CLI layer.

## Architecture
```
core/d1-client.ts   → fetch wrapper, statement-bind helpers, error mapping
core/org.ts         → orgCreate, orgList, orgUse, orgDelete, getActiveDbId
```
`org.ts` depends on `d1-client.ts`, `config.ts`, `errors.ts`. Schema apply called via callback to avoid `core/schema.sql` dep cycle (resolved in phase 04).

## Related Code Files

### To Create
- `src/core/d1-client.ts`
- `src/core/org.ts`
- `src/core/d1-client.test.ts` (mock fetch)
- `src/core/org.test.ts`

## Implementation Steps

### d1-client.ts
1. `interface D1ClientOpts { token: string; accountId: string; baseUrl?: string; fetchImpl?: typeof fetch }`.
2. `class D1Client` constructor stores opts; default `baseUrl = 'https://api.cloudflare.com/client/v4'`.
3. Private `request(path, init)`: adds auth header, content-type, 30s AbortController, parses JSON, maps errors.
4. `query(dbId, sql, params?)`: POST `/d1/database/{dbId}/query` body `{ sql, params }`. Returns first `result[0]` (`{ results, meta }`).
5. `raw(dbId, sql, params?)`: same but `/raw` endpoint, returns columnar.
6. `batch(dbId, statements: {sql, params?}[])`: POST `/batch` body `{ statements }`. Returns array.
7. `listDbs()`: GET `/d1/database`.
8. `createDb(name)`: POST `/d1/database` body `{name}`.
9. `deleteDb(dbId)`: DELETE `/d1/database/{dbId}`.
10. Error mapping helper: status→code, parse `errors[0].message`, attach `retry_after_ms` from `Retry-After` header on 429.
11. Statement guard: throw `INVALID_INPUT` if `params.length > 100` or `sql.length > 100_000`.
12. Batch guard: if `statements.length > 1000` throw `INVALID_INPUT` with hint to split.

### org.ts
1. `slugify(input)`: lowercase, trim, replace non `[a-z0-9]` with `-`, collapse, max 40 chars. Reject empty.
2. `orgCreate({ slug, applySchema })`: validate slug, ensure not in config (`ORG_EXISTS`), call `d1.createDb(slug)`, persist mapping, then `applySchema(dbId)` callback (phase 04 supplies it).
3. `orgList()`: read config, return array `[{ slug, database_id, database_name, created_at, active }]`.
4. `orgUse(slug)`: ensure exists, set `active_org`, save.
5. `orgDelete(slug)`: ensure exists, call `d1.deleteDb`, remove mapping, clear `active_org` if matched.
6. `getActiveDbId(config)`: throw `ORG_NOT_FOUND` if missing; return id.
7. All functions accept `D1Client` + `Config` injected — pure, easy to test.

## Todo List
- [x] D1Client class with query/raw/batch
- [x] mgmt endpoints (list/create/delete db)
- [x] HTTP error → CrmdError mapping (401/403/404/409/429/5xx)
- [x] guards for sql size / param count / batch size
- [x] slugify + collision check
- [x] orgCreate/list/use/delete
- [x] tests with mocked fetch (success + each error path)

## Success Criteria
- All HTTP error paths map to documented `ErrorCode`.
- Round-trip `createDb → listDbs → deleteDb` works against mock.
- Config mutation atomic; no partial writes on schema-apply failure (rollback delete DB? — see risk).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Schema apply fails after DB creation → orphan D1 DB | Medium | Medium | On failure: attempt `deleteDb`, log both errors, surface combined `CrmdError`. |
| Slug collisions across CF account | Low | Medium | Cloudflare returns 409; map to `ORG_EXISTS`. |
| Network flake during batch | Medium | Medium | Single retry on 5xx (no retry on 4xx). Document retry-once policy. |
| Token scoped wrong (missing D1 perm) | Medium | High | Probe `listDbs()` on first use; surface `AUTH_INVALID` with hint. |

## Security
- Token never logged. All requests over HTTPS only (reject non-https `baseUrl` override in production builds — accept only for tests).

## Next Steps
- Phase 04 supplies the `applySchema` callback that `orgCreate` invokes.
