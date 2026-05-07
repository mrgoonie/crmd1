# Phase 02 — Core Foundations

## Context Links
- `docs/system-architecture.md` (error codes, config schema)
- `docs/code-standards.md` (zod everywhere, no any, CrmdError)
- `plans/reports/researcher-260508-0025-cloudflare-d1-access.md` (auth precedence)
- `plans/reports/researcher-260508-0025-crm-data-model.md` (entity fields)

## Overview
- **Priority:** P1
- **Status:** complete
- Build platform-agnostic primitives: errors, ids, logger, config, validators. No D1, no SQL yet.

## Key Insights
- `~/.config/crmd1/config.json` on POSIX vs `%APPDATA%/crmd1/config.json` on Windows. Use `os.homedir()` + `process.env.APPDATA` + `process.env.XDG_CONFIG_HOME`.
- Token resolution: `--token` flag > `CLOUDFLARE_API_TOKEN` env > config file token.
- Logger: stdout reserved for CLI data + MCP JSON-RPC; diagnostics MUST go to stderr.
- Validators derive TS types via `z.infer` — single source of truth.

## Requirements
- `CrmdError` with stable `code`, `message`, `retryable`, optional `details`, `retry_after_ms`.
- `uuidv7()` wrapper (testable shim).
- Logger with `CRMD1_LOG=debug|info|warn|error` env, default `warn`. All output to stderr.
- Config read/write atomic (write to tmp + rename) with 0600 perms on POSIX.
- Validators for: contact, company, deal, activity, task, plus shared fields (audit, custom_fields, pagination).

## Architecture
```
core/errors.ts      → CrmdError class + ERR codes enum
core/ids.ts         → newId(): uuidv7
core/logger.ts      → log.{debug,info,warn,error}, level via env, stderr only
core/config.ts      → loadConfig, saveConfig, configPath, resolveToken
core/validators.ts  → zod schemas + inferred types
```

## Related Code Files

### To Create
- `src/core/errors.ts`
- `src/core/ids.ts`
- `src/core/logger.ts`
- `src/core/config.ts`
- `src/core/validators.ts`
- co-located `*.test.ts` for each

## Implementation Steps

### errors.ts
1. `ErrorCode` union type matching `system-architecture.md` codes.
2. `CrmdError extends Error` with constructor `(code, message, opts?)`.
3. `toJSON()` returns `{ ok:false, error:{ code, message, retryable, details?, retry_after_ms? } }`.
4. `isRetryable(code)` helper.

### ids.ts
1. Re-export `uuidv7` from `uuidv7` as `newId`.
2. `isUuidV7(s: string): boolean` for validation guards.

### logger.ts
1. Levels `debug=10, info=20, warn=30, error=40`.
2. Read `process.env.CRMD1_LOG`, default warn.
3. Format: `[crmd1] [LEVEL] msg {json?}` to `process.stderr`.
4. NEVER touch stdout.

### config.ts
1. `configDir()`: Windows uses `%APPDATA%/crmd1`; else `${XDG_CONFIG_HOME ?? ~/.config}/crmd1`.
2. `configPath()` returns `<dir>/config.json`.
3. `loadConfig()`: read JSON, zod-validate `ConfigSchema`, return defaults if missing.
4. `saveConfig(c)`: mkdir -p, write tmp file, rename, chmod 0o600 on POSIX (skip on Windows).
5. `resolveToken({flagToken?})`: returns first non-empty among flag, `process.env.CLOUDFLARE_API_TOKEN`, `config.token`. Throw `CrmdError('AUTH_MISSING')` if none.
6. `resolveAccountId({flagAccountId?})`: similar precedence with `CLOUDFLARE_ACCOUNT_ID`.
7. `getActiveOrg(c)`: return entry from `c.orgs[c.active_org]` or throw `ORG_NOT_FOUND`.
8. ConfigSchema: `{ version:1, active_org?, account_id?, token?, orgs: Record<slug, { database_id, database_name, created_at }> }`.

### validators.ts
1. Shared `auditFields` zod object (created_at, updated_at, deleted_at, created_by, updated_by — all optional on input).
2. `ContactInput`, `ContactPatch`, `Contact` (full row).
3. Same for Company, Deal, Activity, Task per data-model report.
4. `Pagination`: `{ limit?: number(1..100, default 50), cursor?: string }`.
5. `IdempotencyKey`: `z.string().min(8).max(128).optional()`.
6. Export `z.infer` types: `ContactInput`, `Contact`, etc.

## Todo List
- [x] errors.ts + tests (codes, JSON shape, retryable map)
- [x] ids.ts + tests (length, version 7 prefix)
- [x] logger.ts + tests (level filtering, stderr only)
- [x] config.ts + tests (path resolution, atomic write, token precedence)
- [x] validators.ts + tests (happy path + zod failure for each entity)

## Success Criteria
- All unit tests pass.
- `core/` has no imports from `cli/` or `mcp/`.
- No `console.log` anywhere in `core/`.
- Config round-trips on Windows + POSIX (mocked path).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Config file corruption on crash | Low | Medium | Atomic tmp+rename. |
| Token leak via logs | Medium | High | Logger redacts known token field names; never log full config. |
| Path differences across OS | Medium | Medium | Centralize in `configDir()`; cover both branches in tests. |

## Security
- 0600 perms on POSIX config; warn (stderr) if perms looser.
- Never log token; truncate to last 4 chars when needed.

## Next Steps
- Phase 03 layers D1 client + org management on top of config + errors.
