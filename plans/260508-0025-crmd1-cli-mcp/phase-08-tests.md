# Phase 08 — Tests

## Context Links
- `docs/code-standards.md` (testing rules)
- `docs/project-overview-pdr.md` (N5: ≥70% core coverage)

## Overview
- **Priority:** P1
- **Status:** complete
- Vitest unit tests with `better-sqlite3` for core; integration tests gated by env; CLI smoke tests via spawned bin.

## Key Insights
- D1 SQL ≈ SQLite 3.x → `better-sqlite3` in-memory is a faithful unit-test substrate for everything except network behavior.
- We need a tiny `D1ClientLike` interface so `core/crm/*` accepts either real D1Client or in-memory adapter.
- Integration tests skip cleanly when env vars absent — never fail CI on missing creds.

## Requirements
- ≥70% coverage in `src/core/`.
- Each public `core/crm` function: ≥1 happy + ≥1 error test.
- `D1Client` HTTP error mapping covered for 401/403/404/409/429/5xx.
- CLI smoke: spawn `node dist/crmd1.js --help`, assert output contains subcommands.
- MCP smoke: spawn `node dist/crmd1-mcp.js`, send `initialize` + `tools/list` JSON-RPC, assert response.
- Integration tests: real D1 round-trip if `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set.

## Architecture
```
src/test/
  d1-memory-adapter.ts    → wraps better-sqlite3 to satisfy D1ClientLike
  fixtures.ts             → builders for contacts/companies/deals
  spawn-helpers.ts        → spawn cli/mcp bin, jsonrpc helper
src/**/*.test.ts          → co-located unit tests
tests/integration/
  d1-real.int.test.ts     → describe.skipIf(!env)
tests/smoke/
  cli.smoke.test.ts
  mcp.smoke.test.ts
```

## Related Code Files

### To Create
- `src/test/d1-memory-adapter.ts`
- `src/test/fixtures.ts`
- `src/test/spawn-helpers.ts`
- `tests/integration/d1-real.int.test.ts`
- `tests/smoke/cli.smoke.test.ts`
- `tests/smoke/mcp.smoke.test.ts`
- additional `*.test.ts` co-located if missing

### To Modify
- `vitest.config.ts` — separate projects: `unit`, `integration`, `smoke`.
- `package.json` — scripts `test`, `test:int`, `test:smoke`, `test:cov`.

## Implementation Steps

1. Define `D1ClientLike` interface in `core/d1-client.ts` (extracted from class). Each crm op accepts `D1ClientLike`.
2. **d1-memory-adapter.ts**:
   - Open `new Database(':memory:')`.
   - `query(_dbId, sql, params)` → `db.prepare(sql).all/run(...params)` mapped to D1's `{ results, meta }` shape.
   - `batch(_dbId, statements)` → wrap in `db.transaction`.
   - `raw`, `listDbs`, `createDb`, `deleteDb` — minimal stubs.
3. **fixtures.ts** — `makeContactInput(overrides?)` etc., default valid payloads.
4. **Unit tests** — for each module from phases 02-05; use adapter.
5. **D1Client unit tests** — mock `fetch`; one test per status code mapping.
6. **CLI smoke** — `child_process.spawn` `dist/crmd1.js --help`, assert stdout includes `contact`, `org`, `search`. Use `pnpm build` precondition (vitest globalSetup).
7. **MCP smoke** — spawn `dist/crmd1-mcp.js` with stub env; write `{"jsonrpc":"2.0","id":1,"method":"initialize",...}` then `tools/list`; parse response; assert tool count > 10.
8. **Integration test** — `describe.skipIf(!process.env.CLOUDFLARE_API_TOKEN)`. Creates ephemeral DB `crmd1-it-<random>`, runs schema, inserts contact, searches, deletes DB in `afterAll`.

## Todo List
- [x] D1ClientLike interface extracted
- [x] d1-memory-adapter (sqlite ↔ D1 shape)
- [x] fixtures + spawn helpers
- [x] vitest projects: unit / integration / smoke
- [x] D1Client error mapping tests (mock fetch)
- [x] core/crm/* tests (happy + error each)
- [x] CLI smoke
- [x] MCP smoke
- [x] Real D1 integration test (skipped without env)
- [x] CI config example in README (env: CLOUDFLARE_*)

## Success Criteria
- `pnpm test` (unit) green; coverage ≥70% in core.
- `pnpm test:smoke` green after `pnpm build`.
- `pnpm test:int` green when creds present, skipped otherwise (no failure).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Adapter behaves differently than D1 (esp. FTS5 ranking) | Medium | Medium | Cross-check critical paths in real-D1 integration test. |
| Smoke tests flaky on slow CI cold-start | Medium | Low | Generous timeouts (10s). |
| Integration test leaks D1 DBs on failure | Medium | Medium | `afterAll` always runs delete; print orphan id on failure for manual cleanup. |

## Security
- Integration test uses unique DB name per run; deletes after.
- No tokens in fixtures / committed env files.

## Next Steps
- Phase 09 packages the verified build for distribution.
