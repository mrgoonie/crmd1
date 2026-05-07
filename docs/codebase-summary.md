# Codebase Summary

**crmd1** is a TypeScript CLI + MCP server for AI agents and humans to manage CRM data in Cloudflare D1 (SQLite). This document maps the codebase structure and key abstractions for contributors and LLM consumers.

---

## Quick Facts

- **Language**: TypeScript 5.x, target ES2022, Node ≥20
- **Build**: tsup → `dist/cli.js` + `dist/mcp.js` (ESM, single-file, shebang)
- **Test**: vitest + in-memory better-sqlite3 adapter
- **Platforms**: CLI via `crmd1` command, MCP server via `crmd1-mcp` stdio
- **Entities**: 5 core (contacts, companies, deals, activities, tasks) + FTS5 search

---

## Module Map

### `src/core/` — Pure Logic Layer

**Database & Configuration**
- `d1-client.ts` — Thin REST wrapper for Cloudflare D1 API; methods: `query()`, `batch()`, `raw()`, `createDb()`, `listDbs()`, `deleteDb()`
- `d1-management.ts` — Org-to-DB-ID mapping; methods: `provisionDb()`, `deleteDb()`
- `config.ts` — Read/write `~/.config/crmd1/config.json` (org map, active_org, token)
- `org.ts` — Org CRUD; wraps d1-management API calls
- `db-init.ts` — Schema bootstrap; idempotent DDL + FTS5 trigger application
- `schema.ts` — Exports `SCHEMA_SQL` string (full DDL)

**Primitives**
- `errors.ts` — `CrmdError` class, stable error codes (e.g., `AUTH_MISSING`, `CONFLICT`, `INVALID_INPUT`), `serializeError()`
- `ids.ts` — UUID v7 generation
- `logger.ts` — Structured logging (disabled in prod unless `CRMD1_LOG` set); never logs to stdout in MCP mode
- `validators.ts` — Zod schemas for all shared types: `OrgSlugSchema`, `EmailSchema`, `DomainSchema`, `PaginationSchema`, `IdempotencyKeySchema`, `EntityTypeSchema`

**CRM Core Logic**
- `crm/contacts.ts` — Contact CRUD (create, get, list, update, delete, restore) + soft-delete semantics
- `crm/companies.ts` — Company CRUD + domain unique constraint
- `crm/deals.ts` — Deal CRUD + polymorphic entity refs (contact_id, company_id)
- `crm/activities.ts` — Activity log (polymorphic: can attach to contact, company, or deal)
- `crm/tasks.ts` — Task CRUD + due_date + completion tracking
- `crm/search.ts` — FTS5 full-text search + structured filters across all entities

**Internal Utilities** (`crm/internal/`)
- `cursor.ts` — Pagination via opaque base64url cursors; `encodeCursor()`, `decodeCursor()` (encodes last_created_at + last_id)
- `idempotency.ts` — `withIdempotency()` wrapper for mutating ops; stores in `_crmd1_idempotency` table (24h TTL)
- `sql.ts` — Shared SQL helpers: `parseInput()` (Zod→CrmdError), `serializeCustomFields()`, `parseCustomFields()`, `buildUpdateClause()`, `mapSqliteError()`, `softDeleteFilter()`
- `sqlite-test-adapter.ts` — In-memory better-sqlite3 D1Client mock for unit tests

### `src/cli/` — Command-Line Interface

- `index.ts` — Commander.js entry point; subcommand wiring (org, db, contact, company, deal, activity, task, search)
- `runtime.ts` — Runtime initialization (auth resolution, org switching, config loading)
- `commands/org.ts` — `org create`, `org list`, `org use`, `org current`, `org delete`
- `commands/db.ts` — `db init`, `db query` (raw SQL), `db migrate` (placeholder)
- `commands/contact.ts` — `contact create`, `contact get`, `contact list`, `contact update`, `contact delete`, `contact restore`
- `commands/company.ts` — Company subcommands (mirror contact pattern)
- `commands/deal.ts` — Deal subcommands
- `commands/activity.ts` — `activity log`, `activity get`, `activity list`, `activity delete`
- `commands/task.ts` — Task subcommands + `task complete` status update
- `commands/search.ts` — `search <query>` (FTS5 + filters)
- `output.ts` — Formatter: TTY → pretty table (cli-table3), non-TTY/`--json` → JSON envelope

### `src/mcp/` — MCP Transport Layer

- `server.ts` — MCP stdio server setup (@modelcontextprotocol/sdk); spawns tool handlers with auth + org context
- `context.ts` — `McpContext` type (token, account_id, org_name, client)
- `tools/index.ts` — Tool aggregator: `registerAllTools()`, `getToolDefinitions()`, `invokeToolHandler()`, `TOOL_NAMES` registry
- `tools/org-tools.ts` — MCP handlers for org ops (8 tools: org_create, org_list, org_use, org_current, org_delete, db_init, db_query, crm_search)
- `tools/contact-tools.ts` — 6 contact tools (contact_create, contact_get, contact_list, contact_update, contact_delete, contact_restore)
- `tools/company-tools.ts` — 6 company tools
- `tools/deal-tools.ts` — 6 deal tools
- `tools/activity-tools.ts` — 4 activity tools (activity_log, activity_get, activity_list, activity_delete)
- `tools/task-tools.ts` — 7 task tools (task_create, task_get, task_list, task_update, task_complete, task_delete, task_restore)

### `src/bin/` — Entry Points

- `crmd1.ts` — CLI entry; imports `src/cli/index.ts`, parses argv, runs subcommand
- `crmd1-mcp.ts` — MCP server entry; imports `src/mcp/server.ts`, starts stdio transport

---

## 37 MCP Tools Catalog

### Org & DB (8 tools)
| Tool | Input | Output | Notes |
|------|-------|--------|-------|
| `org_create` | {slug, idempotency_key} | {id, slug, database_id, database_name, created_at} | Provisions D1 DB |
| `org_list` | {} | {items: Org[]} | Lists all accessible orgs |
| `org_use` | {slug} | {active_org, active_database_id} | Sets active org |
| `org_current` | {} | {slug, database_id, database_name} | Shows current active org |
| `org_delete` | {slug, idempotency_key} | {ok: true} | Soft-deletes org record (D1 remains) |
| `db_init` | {idempotency_key} | {ok: true, schema_applied: true} | Runs DDL migrations |
| `db_query` | {sql, params} | {results: any[], meta} | Raw SQL escape hatch |
| `crm_search` | {q, entity_type?, limit?, cursor?} | {items: [], next_cursor?, total_estimate} | FTS5 search |

### Contacts (6 tools)
| Tool | Input | Output |
|------|-------|--------|
| `contact_create` | {email, first_name, last_name, phone?, company_id?, custom_fields?, idempotency_key?} | {id, email, created_at} |
| `contact_get` | {id} | {id, email, first_name, last_name, ...} |
| `contact_list` | {limit?, cursor?, company_id?, email?, status?, include_deleted?} | {items: [], next_cursor?, total_estimate} |
| `contact_update` | {id, first_name?, last_name?, email?, phone?, job_title?, company_id?, status?, notes_summary?, custom_fields?, idempotency_key?} | {id, email, updated_at} |
| `contact_delete` | {id, idempotency_key?} | {ok: true} |
| `contact_restore` | {id, idempotency_key?} | {ok: true} |

### Companies (6 tools)
Mirror contact pattern. Fields: {id, name, domain, industry, custom_fields, created_at, updated_at}.

### Deals (6 tools)
Mirror pattern. Fields: {id, title, value, stage, currency, contact_id, company_id}.

### Activities (4 tools)
| Tool | Input | Output |
|------|-------|--------|
| `activity_log` | {type, note, contact_id?, company_id?, deal_id?, idempotency_key?} | {id, type, created_at} |
| `activity_get` | {id} | {id, type, note, entity_type, entity_id, created_at} |
| `activity_list` | {limit?, cursor?, contact_id?, company_id?, deal_id?} | {items: [], next_cursor?} |
| `activity_delete` | {id, idempotency_key?} | {ok: true} |

### Tasks (7 tools)
| Tool | Input | Output |
|------|-------|--------|
| `task_create` | {title, due_date?, contact_id?, deal_id?, custom_fields?, idempotency_key?} | {id, title, created_at} |
| `task_get` | {id} | {id, title, due_date, completed_at, ...} |
| `task_list` | {limit?, cursor?, contact_id?, deal_id?, status?} | {items: [], next_cursor?} |
| `task_update` | {id, title?, due_date?, status?, assignee?, custom_fields?, idempotency_key?} | {id, title, updated_at} |
| `task_complete` | {id, idempotency_key?} | {ok: true, completed_at} |
| `task_delete` | {id, idempotency_key?} | {ok: true} |
| `task_restore` | {id, idempotency_key?} | {ok: true} |

---

## Key Abstractions

### D1Client
Thin HTTP wrapper around Cloudflare REST API. No async queue or pooling; each call is a single HTTPS request. Supports:
- `query<T>(sql, params?)` — SELECT or write (INSERT/UPDATE/DELETE)
- `batch(statements[])` — Multiple statements in one batch request
- `raw()` — Raw mode (unimplemented in tests)
- `createDb(name)`, `listDbs()`, `deleteDb(dbId)` — Management endpoints

All queries are parameterized (no string concat). Respects D1 limits: 100 KB statement, 100 params, 30 s timeout.

### CrmdError
Structured error with stable codes for agent branching:
```typescript
throw new CrmdError('CONFLICT', 'Email already in use', {
  details: { field: 'email' },
  retryable: false,
});
```
Codes: `AUTH_MISSING`, `AUTH_INVALID`, `ORG_NOT_FOUND`, `ORG_EXISTS`, `DB_INIT_REQUIRED`, `NOT_FOUND`, `CONFLICT`, `INVALID_INPUT`, `RATE_LIMIT`, `DB_ERROR`, `NETWORK`, `INTERNAL`.

### withIdempotency
Wrapper for mutating ops to prevent double-inserts:
```typescript
const result = await withIdempotency(client, 'contact.create', idempotency_key, async () => {
  return await createContact(client, input);
});
```
Stores result in `_crmd1_idempotency(key, response, created_at)` with 24h TTL. Scoped by operation name to prevent cross-op replays.

### parseInput
Zod schema validator that maps validation errors to `CrmdError(INVALID_INPUT, ...)` with field-level issues:
```typescript
const input = parseInput(ContactInputSchema, rawData);
// On error: CrmdError with details.issues = [{path, message}, ...]
```

### Pagination
Opaque cursor-based (not offset). Cursor encodes `{last_created_at, last_id}` as base64url. Enables consistent pagination across concurrent writes.

### FTS5 Sync
Triggers on INSERT/UPDATE/DELETE of contacts, companies, deals, activities maintain a `crm_search` virtual table. Search queries scan this table with `MATCH` operator + structured filters.

---

## Test Layout

**Unit tests** co-located with source (e.g., `contacts.ts` + `contacts.test.ts`):
- All use in-memory `better-sqlite3` via `makeSqliteClient()` from `sqlite-test-adapter.ts`
- No external API calls in unit tests
- Full schema applied via `makeTestDb()` before each test
- Each CRM module tests happy path + error scenarios (e.g., duplicate email → CONFLICT)

**Integration tests** (skipped in CI if no Cloudflare env):
- Spawn real D1 database
- Run full CRUD workflows
- Validate that CLI and MCP endpoints produce same results

**CLI smoke tests** (`cli/index.test.ts`):
- Spawn `crmd1` binary as subprocess
- Assert exit codes + JSON output shape

**Coverage target**: ≥70% on `core/` (business logic).

---

## Build Pipeline

**`pnpm build`** → tsup with:
- Entry: `src/bin/crmd1.ts` → `dist/cli.js`, `src/bin/crmd1-mcp.ts` → `dist/mcp.js`
- Format: ESM only
- Target: Node 20
- Banner: `#!/usr/bin/env node` for direct execution
- Minify: off (keep readable)
- Sourcemap: on
- Define: `__PKG_VERSION__` injected at build time (so bundled CLI doesn't read package.json)

**Distribution**: npm package.json `bin` points to `dist/cli.js` + `dist/mcp.js`; users run `crmd1` or `npx crmd1-mcp`.

---

## Data Model

### Five Core Tables
| Table | Key Fields | Audit |
|-------|-----------|-------|
| `contacts` | id (uuid), email (unique), first_name, last_name, phone, job_title, company_id (fk), status (enum), notes_summary, custom_fields (json) | created_at, updated_at, deleted_at, created_by, updated_by |
| `companies` | id, name, domain (unique), industry, custom_fields | audit fields |
| `deals` | id, title, value (decimal), stage, currency, contact_id (fk), company_id (fk) | audit fields |
| `activities` | id, type (enum: call/email/meeting/note), note, entity_type (enum), entity_id (fk to contact/company/deal) | audit fields |
| `tasks` | id, title, due_date, status (enum: open/completed), assignee, entity_type, entity_id, custom_fields | audit fields |

### Virtual Table
- `crm_search` — FTS5 virtual table; indexed over contacts.{email, first_name, last_name, notes}, companies.{name, domain}, activities.note. Updated by insert/update/delete triggers. Enables fast full-text search across all entities.

### Idempotency Table
- `_crmd1_idempotency` — Stores {key (unique), response (json), created_at}; TTL enforced at query time.

### Schema Format
- Full DDL in `src/core/schema.ts` (exported as `SCHEMA_SQL` string constant)
- No migration files yet (v0.1.0); schema is idempotent
- Applied via `db_init` (org command or MCP tool)

---

## Configuration

**Location**: `~/.config/crmd1/config.json` (platform-aware via Node APIs)

**Schema**:
```json
{
  "version": 1,
  "active_org": "acme",
  "account_id": "xxx",
  "orgs": {
    "acme": {
      "database_id": "uuid-xxx",
      "database_name": "crmd1-acme",
      "created_at": "2026-05-08T..."
    }
  }
}
```

**Token Resolution** (in order):
1. `--token` CLI flag
2. `CLOUDFLARE_API_TOKEN` env var
3. `~/.config/crmd1/config.json` `token` field (optional, not recommended)

Missing token → `AUTH_MISSING` error.

---

## Adding a New Entity

### Recipe (3 steps)

**Step 1: Schema** (`src/core/schema.ts`)
- Add table DDL with audit columns (id, created_at, updated_at, deleted_at)
- Add FTS5 trigger if searchable

**Step 2: CRUD Module** (`src/core/crm/{entity}.ts`)
- Define Zod schemas: `{Entity}InputSchema`, `{Entity}PatchSchema`, `{Entity}ListParamsSchema`
- Implement functions: `create()`, `get()`, `list()`, `update()`, `delete()`, `restore()`
- Each function: validate input with `parseInput()`, map SQLite errors with `mapSqliteError()`, use `withIdempotency()` on mutations
- Co-locate `.test.ts` with in-memory adapter tests

**Step 3: CLI + MCP Wiring**
- CLI: `src/cli/commands/{entity}.ts` (wrap CRUD module, format output via `formatOutput()`)
- MCP: `src/mcp/tools/{entity}-tools.ts` (register handlers, serialize errors)
- Update `src/mcp/tools/index.ts` `TOOL_NAMES` array

---

## Error Boundaries

Errors are caught + serialized at:
1. **CLI command handlers** (`src/cli/commands/*.ts`) → format JSON + exit code
2. **MCP tool handlers** (`src/mcp/tools/*.ts`) → MCP-compatible error response
3. **Core modules** → throw `CrmdError` (never swallow silently)

Contract: `{ok: false, error: {code, message, retryable, details?}}`

---

## Development Workflow

```bash
# Install
pnpm i

# Test with coverage
pnpm test:coverage

# Typecheck
pnpm typecheck

# Build
pnpm build

# Run CLI
node dist/cli.js --help

# Run MCP (stdin/stdout)
node dist/mcp.js

# Lint + fix
pnpm lint --fix
```

---

## Key File Locations

- **Org/auth logic** → `src/core/org.ts`, `src/core/config.ts`
- **CRUD recipes** → `src/core/crm/*.ts`
- **Pagination** → `src/core/crm/internal/cursor.ts`
- **Error serialization** → `src/core/errors.ts`
- **CLI dispatch** → `src/cli/index.ts`
- **MCP dispatch** → `src/mcp/server.ts`
- **Output formatting** → `src/cli/output.ts`
- **Zod validators** → `src/core/validators.ts`

---

## Constraints & Non-Goals (v0.1.0)

- **No UI** — CLI + MCP only
- **No permissions** — Single token = full access (single-user per org)
- **No webhooks** — No event integration with Stripe, HubSpot, Pipedrive
- **No background jobs** — All operations are synchronous request/response
- **No encryption-at-rest** — Relies on Cloudflare D1 security model
- **No schema migrations** — DDL is append-only; migrations table deferred

---

*Last updated: 2026-05-08 for v0.1.0 release.*
