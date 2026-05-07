# Phase 09 — Build & Package

## Context Links
- `docs/system-architecture.md` (build / distribute)
- `docs/code-standards.md` (commit conventions)

## Overview
- **Priority:** P2
- **Status:** complete
- Finalize tsup config for two bins, npm metadata, README quick-start, prepare for `npm publish`.

## Key Insights
- ESM + shebang: tsup `banner.js = '#!/usr/bin/env node'` only on entries that are bins; we use `tsup` `--shims` for cross-format compat.
- `package.json` `bin` mapping must match emitted filenames in `dist/`.
- `prepublishOnly` runs full build + tests to prevent shipping broken artifacts.

## Requirements
- `pnpm build` produces `dist/crmd1.js` + `dist/crmd1-mcp.js`, both ESM, with shebang and 0755 perms.
- `package.json`:
  - `name: crmd1`
  - `version: 0.1.0`
  - `description`, `keywords`, `license: MIT`, `author`, `repository`, `bugs`, `homepage`.
  - `engines.node: ">=20"`.
  - `bin: { crmd1, crmd1-mcp }`.
  - `files: ["dist","README.md","LICENSE"]`.
  - Scripts: `build`, `test`, `test:int`, `test:smoke`, `lint`, `format`, `typecheck`, `prepublishOnly`.
- `README.md` (root) with quick-start: install, `org create`, MCP config snippet for Claude Desktop / generic MCP client.
- `CHANGELOG.md` skeleton with 0.1.0 entry.
- `LICENSE` (MIT).

## Architecture
- Single npm package, two bin entries. No publish-time bundling beyond tsup.

## Related Code Files

### To Modify
- `tsup.config.ts` — two entries, banner shebang, chmod 0755 in onSuccess.
- `package.json` — full publish metadata.

### To Create
- `README.md`
- `CHANGELOG.md`
- `LICENSE`

## Implementation Steps

1. Update `tsup.config.ts`:
   - `entry: { crmd1: 'src/bin/crmd1.ts', 'crmd1-mcp': 'src/bin/crmd1-mcp.ts' }`.
   - `format: ['esm']`, `target: 'node20'`, `clean: true`, `splitting: false`, `shims: true`.
   - `banner: { js: '#!/usr/bin/env node' }`.
   - `onSuccess: 'node scripts/chmod-bins.mjs'` to `chmod 0o755` on POSIX (no-op on Windows).
   - Loader for `.sql`: `'text'`.
2. Write `scripts/chmod-bins.mjs`.
3. Update `package.json` with full publish metadata + `prepublishOnly: "pnpm typecheck && pnpm lint && pnpm test && pnpm build"`.
4. Write `README.md`:
   - Install: `npm i -g crmd1` or `npx crmd1`.
   - First run: `crmd1 config set token` (or env), `crmd1 org create acme`, `crmd1 db init`.
   - CLI examples: contact create/list, search.
   - MCP setup snippet (e.g., Claude Desktop `mcpServers.crmd1` config).
   - Env var reference table.
   - Error code table.
   - Limits table (D1 30s/100KB/100params/1000 batch).
5. Write `CHANGELOG.md` 0.1.0 entry summarizing scope.
6. Add `LICENSE` (MIT, current year).
7. Verify `npm pack --dry-run` includes only `dist/`, `README.md`, `LICENSE`, `package.json`.

## Todo List
- [x] tsup.config.ts finalized (two entries, shebang, version define, sql loader)
- [x] scripts/chmod-bins.mjs (no-op on Windows; tsup handles shebang via banner)
- [x] package.json publish metadata + prepublishOnly
- [x] README.md quick-start (install, org, CLI, MCP, env, errors)
- [x] CHANGELOG.md 0.1.0
- [x] LICENSE MIT
- [x] `npm pack --dry-run` clean tarball (130.9 kB, 7 files)

## Success Criteria
- `pnpm build` then `node dist/crmd1.js --help` works.
- `node dist/crmd1-mcp.js` accepts JSON-RPC `tools/list`.
- Tarball ≤ 1 MB and contains no source.
- README enables a new user to bootstrap an org in <5 minutes.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Shebang breaks on Windows-only consumer | Low | Low | npm rewrites bins to `.cmd` shims automatically. |
| Including dev `.env` in tarball | Low | High | `files` whitelist + `.npmignore`; verify with `npm pack --dry-run`. |
| Publishing broken artifact | Medium | High | `prepublishOnly` runs full pipeline. |

## Security
- `npm pack --dry-run` audited before first publish; ensure no `.env*`, no `tests/`, no `src/` leak.
- `npm publish --access public` documented (not run by Claude).

## Next Steps
- Tag `v0.1.0`, publish to npm (operator action, out of scope here).
- Plan v0.2: rate limit, audit log table, OAuth for MCP.

## Unresolved Questions
- Should `crmd1` ship pre-built or rely on `npx` + tsup-on-install? (Decided: pre-built `dist/`.)
- Do we need a separate `@crmd1/core` package for embedding without bins? (Deferred to v0.2.)
