# System Architecture

## Topology

```
┌──────────────┐    ┌──────────────┐
│   Operator   │    │   AI Agent   │
│  (terminal)  │    │ (MCP client) │
└──────┬───────┘    └──────┬───────┘
       │ argv               │ stdio (JSON-RPC)
┌──────▼───────┐    ┌──────▼───────┐
│  bin/crmd1   │    │bin/crmd1-mcp │
│   (CLI)      │    │ (MCP server) │
└──────┬───────┘    └──────┬───────┘
       │                    │
       └────────┬───────────┘
                │ same calls
       ┌────────▼─────────┐
       │   src/core/      │  pure logic, zod-validated I/O
       │  crm operations  │
       └────────┬─────────┘
                │ HTTPS (REST)
       ┌────────▼─────────┐
       │ Cloudflare D1    │  one DB per organization
       │  REST API        │
       └──────────────────┘

Local state: ~/.config/crmd1/config.json   (token, account_id, org map, active_org)
```

## Module Layout

```
src/
├── core/                  # pure, no CLI/MCP imports
│   ├── d1-client.ts       # thin REST wrapper (query, raw, batch)
│   ├── d1-management.ts   # org-to-DB-ID provisioning + deletion
│   ├── config.ts          # read/write ~/.config/crmd1/config.json
│   ├── org.ts             # org create/list/use/delete (wraps d1-management)
│   ├── schema.ts          # CRM DDL + FTS5 triggers (string export SCHEMA_SQL)
│   ├── db-init.ts         # idempotent schema bootstrap
│   ├── ids.ts             # uuidv7 wrapper
│   ├── errors.ts          # CrmdError class + stable error codes
│   ├── logger.ts          # structured logging (stderr only)
│   ├── validators.ts      # zod schemas for all entities
│   └── crm/
│       ├── contacts.ts
│       ├── companies.ts
│       ├── deals.ts
│       ├── activities.ts
│       ├── tasks.ts
│       ├── search.ts      # FTS5 + structured filter
│       └── internal/
│           ├── cursor.ts           # opaque pagination encoding
│           ├── idempotency.ts      # withIdempotency wrapper
│           ├── sql.ts              # shared helpers (parseInput, etc.)
│           └── sqlite-test-adapter.ts  # in-memory D1Client mock
├── cli/
│   ├── index.ts           # commander entry, subcommand wiring
│   ├── runtime.ts         # auth + org resolution
│   ├── output.ts          # TTY/JSON formatter, cli-table3
│   └── commands/
│       ├── org.ts
│       ├── db.ts
│       ├── contact.ts
│       ├── company.ts
│       ├── deal.ts
│       ├── activity.ts
│       ├── task.ts
│       └── search.ts
├── mcp/
│   ├── server.ts          # @modelcontextprotocol/sdk stdio server
│   ├── context.ts         # McpContext type + buildMcpContext()
│   └── tools/
│       ├── index.ts       # registerAllTools() + TOOL_NAMES registry
│       ├── org-tools.ts
│       ├── contact-tools.ts
│       ├── company-tools.ts
│       ├── deal-tools.ts
│       ├── activity-tools.ts
│       └── task-tools.ts
└── bin/
    ├── crmd1.ts
    └── crmd1-mcp.ts
```

## D1 Access

- Raw HTTPS to `https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{db_id}/query` and `/raw`, `/batch`.
- Auth header `Authorization: Bearer <CLOUDFLARE_API_TOKEN>` (Account.D1 perm).
- Bound parameters; never string-concat user input.
- Hard limits respected: 30 s timeout, 100 KB statement, 100 params per query, batch ≤ 1000 rows.

## Data Model (per org DB)

5 base tables + 1 FTS5 virtual table + 1 idempotency table (full DDL in `src/core/schema.ts` as `SCHEMA_SQL` export):

- `contacts` (id pk, email unique, first_name, last_name, company_id fk, custom_fields json, audit fields)
- `companies` (id pk, domain unique, name, custom_fields json, audit fields)
- `deals` (id pk, name, stage, amount, currency, contact_id fk, company_id fk, audit fields)
- `activities` (id pk, type, subject, body, entity_type, entity_id, audit fields)  ← polymorphic
- `tasks` (id pk, title, due_date, status, assignee, entity_type, entity_id, audit fields)
- `crm_search` (FTS5 virtual table: contacts.email/name/notes, companies.name/domain, activities.body)

IDs: UUID v7. Soft delete via `deleted_at TIMESTAMP NULL`. Triggers maintain FTS5.

## Configuration

Path: `~/.config/crmd1/config.json` (Windows: `%APPDATA%/crmd1/config.json`).

```json
{
  "version": 1,
  "active_org": "acme",
  "account_id": "abc123",
  "orgs": {
    "acme": { "database_id": "uuid", "database_name": "crmd1-acme", "created_at": "..." }
  }
}
```

Token resolution order:
1. `--token` flag
2. `CLOUDFLARE_API_TOKEN` env
3. `~/.config/crmd1/config.json` (`token` field, optional)

If none present → error code `AUTH_MISSING`.

## Error Codes

```
AUTH_MISSING        – no API token
AUTH_INVALID        – Cloudflare 401/403
ORG_NOT_FOUND       – unknown org slug
ORG_EXISTS          – create collision
DB_INIT_REQUIRED    – schema not applied
NOT_FOUND           – entity not in DB
CONFLICT            – unique violation (email/domain)
INVALID_INPUT       – zod parse failure (with path)
RATE_LIMIT          – CF 429 (with retry_after_ms)
DB_ERROR            – wrapped Cloudflare error
```

## Output Contract

- TTY humans: pretty table via `cli-table3`, dim metadata, exit 0/1.
- Non-TTY / `--json`: `{"ok":true,"data":...}` or `{"ok":false,"error":{"code":"...","message":"...","retryable":bool}}`.
- MCP: same JSON shape; large lists return `{items, next_cursor, total_estimate}`.

## Testing

- **Unit** (`vitest`): core logic with `better-sqlite3` in-memory; same SQL as D1 (compatible subset).
- **Integration**: a real D1 DB if `CLOUDFLARE_API_TOKEN`+`CLOUDFLARE_ACCOUNT_ID` available; skipped otherwise.
- **CLI smoke**: spawn `crmd1` binary, assert exit codes & JSON output.

## Build / Distribute

- `tsup` bundles to `dist/cli.js` + `dist/mcp.js` (ESM).
- `package.json` `bin`: `crmd1` → `dist/cli.js`, `crmd1-mcp` → `dist/mcp.js`.
- `pnpm` for dev, npm-installable for users.
