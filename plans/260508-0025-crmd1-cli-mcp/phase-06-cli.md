# Phase 06 — CLI

## Context Links
- `plans/reports/researcher-260508-0025-agent-cli-mcp-patterns.md` (TTY detection, output format, idempotency)
- `docs/system-architecture.md` (output contract)

## Overview
- **Priority:** P1
- **Status:** complete
- Wire `commander` subcommands to `core/` ops. TTY → human table; non-TTY or `--json` → structured JSON.

## Key Insights
- One global `--json`, `--token`, `--account-id`, `--org` flag set on root command, inherited.
- Cold start <200ms: lazy-import command modules inside their `.action()` to avoid loading uuidv7/zod/etc unless needed.
- Boundary catch in `cli/index.ts`: any `CrmdError` → JSON output + exit 1; unknown → log stack to stderr, exit 2.

## Requirements
- Bin `crmd1` with subcommands:
  - `org create <slug>`, `org list`, `org use <slug>`, `org delete <slug>`
  - `db init`, `db migrate`, `query <sql> [--params <json>]`
  - `contact create|get|list|update|delete|restore`
  - `company create|get|list|update|delete|restore`
  - `deal create|get|list|update|delete|restore`
  - `activity log|get|list|delete`
  - `task create|get|list|update|complete|delete|restore`
  - `search <q> [--types contact,company,...]`
- Output module: table renderer (TTY) + JSON renderer (non-TTY/`--json`).

## Architecture
```
src/cli/index.ts          → program setup, global flags, subcommand registration
src/cli/output.ts         → renderResult({ok, data|error}, fmt) — table or json
src/cli/context.ts        → buildContext(opts) → { config, d1, activeDbId } (lazy)
src/cli/commands/
  org.ts
  db.ts
  contact.ts
  company.ts
  deal.ts
  activity.ts
  task.ts
  search.ts
src/bin/crmd1.ts          → import './cli/index.js' and invoke
```

## Related Code Files

### To Create
- `src/cli/index.ts`
- `src/cli/output.ts`
- `src/cli/context.ts`
- `src/cli/commands/{org,db,contact,company,deal,activity,task,search}.ts`
- `src/bin/crmd1.ts`
- co-located tests (output formatting; command parsing via `program.parseAsync` with mocked context)

## Implementation Steps

1. **bin/crmd1.ts** — `#!/usr/bin/env node`, `import { run } from '../cli/index.js'; run(process.argv);`.
2. **cli/index.ts**:
   - Construct `Command` named `crmd1`.
   - Global options: `--json`, `--token <t>`, `--account-id <id>`, `--org <slug>`, `--idempotency-key <k>`.
   - Register each subcommand module via `register(program, ctxFactory)` pattern.
   - Wrap `program.parseAsync` in try/catch; on `CrmdError` print structured output via `output.ts`, `process.exit(1)`. On other → log to stderr, exit 2.
3. **cli/output.ts**:
   - `renderOk(data, opts)`, `renderErr(err, opts)`.
   - JSON mode: write `JSON.stringify({ok:true,data})` (or err shape) + `\n` to stdout.
   - TTY mode: pick renderer per data shape: array of objects → cli-table3; single object → 2-col key/value table; primitives → string.
4. **cli/context.ts** — `buildContext(globalOpts)`: load config, resolve token + accountId, build `D1Client`, resolve active org if needed.
5. **commands/org.ts** — wire to `core/org` functions; on create, after success print mapping; show table on list with `*` next to active.
6. **commands/db.ts**:
   - `init`: ensures active org, calls `applySchema`, prints applied migrations.
   - `migrate`: alias for `init` (forward-looking).
   - `query <sql>`: passes `--params <json>` parsed array to `d1.query`. **Print warning** that this bypasses validation. Refuse to run if SQL contains `;` followed by another statement unless `--allow-multi`.
7. **commands/contact.ts** etc. — flag→input mapping using zod parse; on success print created/updated row; on list use `--limit`, `--cursor`, `--status`, `--company-id` filters.
8. **commands/search.ts** — pass q, types, limit, cursor; render table with columns `type, id, snippet`.

## Todo List
- [x] bin/crmd1.ts shebang entry
- [x] cli/index.ts global options + boundary catch
- [x] cli/output.ts (json + table)
- [x] cli/context.ts (lazy d1 client) → implemented as cli/runtime.ts
- [x] commands/org.ts
- [x] commands/db.ts (init, query)
- [x] commands/contact.ts
- [x] commands/company.ts
- [x] commands/deal.ts
- [x] commands/activity.ts
- [x] commands/task.ts
- [x] commands/search.ts
- [x] tests for output renderers + command parsing

## Success Criteria
- `crmd1 --help` lists all subcommands; <200ms cold start (measured `time crmd1 --help`).
- `crmd1 contact list --json | jq` produces valid JSON.
- All errors emit `{ok:false,error:{code,...}}` with non-zero exit.
- Active org indicator shown in `org list` TTY output.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Cold-start regression from heavy imports | Medium | Medium | Dynamic `await import()` inside each command's action. |
| `query` raw SQL escape hatch misuse | Medium | High | Stderr warning; refuse multi-statement unless `--allow-multi`; never log results to history file. |
| Confusing output when stdout piped to less | Low | Low | Default to JSON when not TTY; document `--no-json` if user wants table piped. |

## Security
- `--token` value never echoed even on errors.
- `query` command logs only SQL, not params.

## Next Steps
- Phase 07 (MCP) reuses commands' core wiring with zod tool schemas.
