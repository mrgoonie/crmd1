# Phase 01 — Project Setup

## Context Links
- `docs/code-standards.md` (TS config, biome, naming)
- `docs/system-architecture.md` (module layout)

## Overview
- **Priority:** P1 (blocker for everything)
- **Status:** complete
- Bootstrap monorepo-free pnpm project with TypeScript strict mode, biome, vitest, tsup, two bin entries.

## Key Insights
- Node 20+ gives `fetch`, top-level await, `node:` imports — no polyfills.
- `tsup` produces ESM bundles per bin; faster cold start than ts-node.
- biome replaces eslint+prettier (one config, fast).

## Requirements
- pnpm initialized; lockfile committed.
- TypeScript strict + `noUncheckedIndexedAccess`.
- biome configured (2-space, single quote, trailing comma).
- vitest configured (no globals; explicit imports).
- tsup config for two entries: `src/bin/crmd1.ts`, `src/bin/crmd1-mcp.ts`.
- `package.json` `bin`, `scripts`, `engines.node >= 20`.
- Folder skeleton under `src/` matching architecture doc.

## Architecture
Single-package layout. ESM only (`"type": "module"`). Output bundles to `dist/`.

## Related Code Files

### To Create
- `package.json`
- `pnpm-workspace.yaml` (omit unless future workspace needed — skip)
- `tsconfig.json`
- `biome.json`
- `vitest.config.ts`
- `tsup.config.ts`
- `.editorconfig`
- `.gitignore`
- `.npmignore`
- `src/core/.gitkeep`
- `src/cli/.gitkeep`
- `src/mcp/.gitkeep`
- `src/bin/.gitkeep`

## Implementation Steps
1. `pnpm init`; set `"type": "module"`, `"engines.node": ">=20"`.
2. `pnpm add -D typescript @types/node tsup vitest @biomejs/biome`.
3. `pnpm add zod commander uuidv7 cli-table3 @modelcontextprotocol/sdk`.
4. `pnpm add -D better-sqlite3 @types/better-sqlite3` (for unit tests).
5. Write `tsconfig.json`: target ES2022, module ESNext, moduleResolution bundler, strict, noUncheckedIndexedAccess, isolatedModules, declaration off (bundler emits).
6. Write `biome.json`: formatter + linter, 2-space, single quotes, trailing commas all, semicolons always, line width 100.
7. Write `tsup.config.ts`: two entries, format esm, target node20, shims true, splitting false, clean true, minify false, banner `#!/usr/bin/env node` for bins.
8. Write `vitest.config.ts`: node env, include `src/**/*.test.ts`, coverage v8 with text+html.
9. Write `.editorconfig` (utf-8, lf, 2-space).
10. Write `.gitignore` (node_modules, dist, .env*, coverage, *.log, .DS_Store).
11. Write `.npmignore` (src, tests, configs — only ship `dist/`, `README.md`, `package.json`, `LICENSE`).
12. Add `package.json` scripts: `build`, `dev`, `test`, `test:watch`, `lint`, `format`, `typecheck`.
13. Add `bin` entries: `crmd1` → `dist/crmd1.js`, `crmd1-mcp` → `dist/crmd1-mcp.js`.
14. Create empty src/ folder skeleton (`core/`, `core/crm/`, `core/migrations/`, `cli/`, `cli/commands/`, `mcp/`, `bin/`).
15. Run `pnpm typecheck` — must pass empty.

## Todo List
- [x] pnpm init + deps
- [x] tsconfig.json strict
- [x] biome.json
- [x] tsup.config.ts (two entries)
- [x] vitest.config.ts
- [x] package.json scripts + bin
- [x] .editorconfig / .gitignore / .npmignore
- [x] src/ folder skeleton
- [x] `pnpm typecheck` green

## Success Criteria
- `pnpm install` clean.
- `pnpm typecheck` exits 0 on empty project.
- `pnpm lint` exits 0.
- `pnpm build` produces `dist/crmd1.js` + `dist/crmd1-mcp.js` (even if stub).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `better-sqlite3` native build failure on Windows | Medium | Medium | Document `windows-build-tools` prereq in README. |
| ESM/CJS interop with @modelcontextprotocol/sdk | Low | High | tsup `shims: true`; verify SDK exports ESM. |
| biome rules clash with team taste | Low | Low | Tune `biome.json` once; commit. |

## Security
- No secrets in repo. `.env*` ignored.

## Next Steps
- Phase 02 implements core foundations on this skeleton.
