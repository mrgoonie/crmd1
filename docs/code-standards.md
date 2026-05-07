# Code Standards

## Language & Runtime

- TypeScript 5.x, target `ES2022`, module `ESNext`, `moduleResolution: bundler`.
- Node ≥ 20 (top-level await, `fetch`, `node:` imports).
- Strict mode on (`strict: true`, `noUncheckedIndexedAccess: true`).

## Formatting & Linting

- **biome** (single tool, `biome.json`): formatter + linter.
- 2-space indent, single quotes, trailing commas, semicolons on.
- 100 col soft, 120 hard.

## File & Naming

- **kebab-case** filenames (e.g., `d1-client.ts`, `contact-create.ts`).
- Files ≤ 200 LOC. Split when exceeded.
- One default export per file is fine; named exports preferred for tree-shaking.
- Folder `core/` MUST NOT import from `cli/` or `mcp/`.

## Type Discipline

- Zod schemas at every I/O boundary (CLI args, MCP tool params, DB rows).
- `z.infer<typeof schema>` to derive TS types — single source of truth.
- No `any`. Use `unknown` + narrow.
- Errors: throw `CrmdError` from `core/errors.ts`; never plain `Error` outside boundaries.

## SQL Discipline

- Always parameterized; never string-concat user input.
- DDL in `core/schema.ts` as `SCHEMA_SQL` constant. Migrations registry in `core/migrations/index.ts` with embedded SQL strings.
- Every table has `id`, `created_at`, `updated_at`, `deleted_at` (nullable for soft delete).

## Logging

- No `console.log` in `core/`. Use a small `core/logger.ts` (level via `CRMD1_LOG`).
- CLI output goes to `stdout`; diagnostics to `stderr`.
- MCP server: never log to stdout (corrupts JSON-RPC); stderr only.

## Error Handling

- Boundary catches at CLI command handler + MCP tool wrapper. They serialize `CrmdError` to the structured output contract.
- No silent catches. Re-throw with context if you can't fully handle.

## Testing

- `vitest` co-located: `foo.ts` + `foo.test.ts`.
- No fake/mock data shortcuts that hide real behavior. Use in-memory SQLite for fast unit tests.
- Every public function in `core/crm/*` has at least one happy-path + one error test.

## Commits

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `build:`.
- No AI references in messages.
- Don't use `chore` / `docs` for `.claude/` changes (per repo rule).

## YAGNI / KISS / DRY

- v1 has no ORM. Hand-rolled SQL is fine and cheaper to read.
- No plugin systems, no abstract base classes, no premature interfaces.
- If three call sites repeat → extract. Two → leave it.
