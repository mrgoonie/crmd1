# Project Changelog

Detailed record of significant changes, features, fixes, and releases.

---

## Unreleased

### Features

- **Claude Code Plugin** (`crmx`): Marketplace entry at `.claude-plugin/marketplace.json` enables `/plugin marketplace add mrgoonie/crmd1` → `/plugin install crmx@crmd1`.
  - SKILL.md (173 lines): Teaches Claude to drive CLI for Task Management, Customer Management, Agency/Partner Management, Company Member Management.
  - `references/cli-cheatsheet.md`: One-page command map.
  - `references/schema.md`: Entity field reference.

### Changes

- **Package rename**: `crm-d1` (was `crmd1`). Updated npm install: `npm i -g crm-d1`.
- **Test portability**: `src/core/config.test.ts` uses `join()` for cross-platform path expectations.

---

## 0.1.0 — 2026-05-08

### Features

**Core Foundations**
- Error handling via `CrmdError` with stable error codes and retry metadata.
- ID generation with uuid v7 (sortable, testable).
- Logger with level filtering (`debug|info|warn|error`) via `CRMD1_LOG` env.
- Config storage (`~/.config/crmd1/config.json` on POSIX, `%APPDATA%/crmd1/config.json` on Windows) with atomic writes.
- Zod validators for all entities (Contact, Company, Deal, Activity, Task) and shared constructs (pagination, audit fields, custom fields).

**D1 + Organization Management**
- D1 REST client wrapper (`D1Client`): `query`, `raw`, `batch` endpoints with parameterized SQL.
- Cloudflare account management: create/list/delete D1 databases.
- HTTP error mapping (401/403/404/429/5xx) to structured error codes.
- Per-org isolation: `org create <slug>`, `org list`, `org use <slug>`, `org delete <slug>`.

**Database**
- Canonical schema (5 tables: contacts, companies, deals, activities, tasks).
- FTS5 full-text search table (`crm_search`) with triggers for auto-indexing.
- Soft delete with `deleted_at` column (all reads filter `IS NULL`).
- Migrations table (`_migrations`) with idempotent applier.
- Idempotency table (`_crmd1_idempotency`) for replay safety.

**CRM Operations**
- CRUD per entity: `create`, `get`, `update`, `softDelete`, `restore`, `list`.
- Cursor-based pagination (opaque base64 encoding of `{last_created_at, last_id}`).
- FTS5-backed search across all entity types via `crm_search` table.
- Idempotency wrapper for all mutations (24h TTL, replay-safe).
- Custom fields as JSON (round-tripped safely).
- Activities: append-only (no update), immutable by design.
- Deals: linked_contacts helpers for JSON array mutations.
- Tasks: `completeTask` helper for status management.

**CLI (`crmd1`)**
- `org` commands: create, list, use, delete.
- `db` commands: init (schema apply), migrate (alias), query (raw SQL).
- CRUD for all entities: contact, company, deal, activity, task.
- `search <query>` across all entity types.
- Global flags: `--json`, `--token`, `--account-id`, `--org`, `--idempotency-key`.
- Output modes: TTY → cli-table3; non-TTY/`--json` → structured JSON.
- Error messages: `{ok: false, error: {code, message, retryable, details}}` JSON format.
- <200ms cold start via lazy module loading.

**MCP Server (`crmd1-mcp`)**
- Stdio transport (JSON-RPC over stdout, stderr for logging).
- 37 tools across 8 intent types:
  - Reads: `contact_search`, `contact_get`, `company_search`, `company_get`, `deal_search`, `deal_get`, `activity_list`, `task_list`, `crm_search`.
  - Writes: `contact_create`, `contact_update`, `company_create`, `company_update`, `deal_create`, `deal_update`, `activity_log`, `task_create`, `task_update`, `task_complete`, `entity_delete`.
  - Org/DB: `org_create`, `org_list`, `org_use`, `org_delete`, `db_init`.
- Zod-derived schemas for all tool inputs.
- Idempotency keys honored on all writes.
- Auth via env: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CRMD1_ORG`.
- Structured error responses with MCP error flag.

**Testing**
- Unit tests via Vitest with better-sqlite3 adapter for SQL testing.
- Co-located `.test.ts` files in src/ (happy path + error scenarios).
- D1Client HTTP error mapping tests (mock fetch).
- Core CRM operations tests (cursor pagination, idempotency, FTS5).
- CLI smoke tests (spawn bin, verify help + basic commands).
- MCP smoke tests (spawn bin, verify `initialize` + `tools/list`).
- Coverage target: >70% in `src/core/`.

**Build + Package**
- tsup config: two ESM entries (`src/bin/crmd1.ts`, `src/bin/crmd1-mcp.ts`).
- Shebang injection + 0755 perms on POSIX.
- `package.json` full publish metadata (name, version, keywords, license, repository, bugs, homepage).
- npm tarball: `dist/`, `README.md`, `LICENSE`, `package.json` only.
- `prepublishOnly` script enforces full test + lint + build.

### Breaking Changes

None (initial release).

### Known Limitations

- **Idempotency cleanup**: Rows in `_crmd1_idempotency` accumulate indefinitely. Manual cleanup via:
  ```bash
  crmd1 db query "DELETE FROM _crmd1_idempotency WHERE created_at < datetime('now','-1 day')"
  ```
  Scheduled auto-cleanup tracked for v0.2.

- **Soft-delete FTS regression**: Deleted entities remain in `crm_search` FTS index until manual optimize. Rebuild via:
  ```bash
  crmd1 db query "INSERT INTO crm_search(crm_search, rank) VALUES('optimize', -1)"
  ```

- **Multi-statement queries**: `crmd1 db query` rejects SQL with multiple `;`-separated statements unless `--allow-multi` flag (safer default for v0.1).

- **Rate limiting**: None. Per-org limits planned for v0.3.

- **Audit log**: `_crmd1_audit` table schema reserved; not exposed via API yet. Planned for v0.2.

- **Shell completion**: Not included. Planned for v0.2.

### Security

- All SQL parameterized; no string concatenation.
- FTS5 input quoted to prevent injection.
- Token never logged; env var only (no CLI history).
- Config file 0600 perms on POSIX.
- MCP stderr-only logging (stdout reserved for JSON-RPC).

### Performance

- Cold start <200ms (lazy module loading).
- Cursor pagination O(1) per page (no offset scans).
- FTS5 search sub-second on typical org data.
- D1 statement timeout 30s; batch ≤1000 (Paid) / 50 (Free).

### Dependencies

- **Runtime**: commander, zod, uuidv7, cli-table3, @modelcontextprotocol/sdk.
- **Dev**: typescript, vitest, @vitest/coverage-v8, better-sqlite3, @biomejs/biome, tsup.

---

## Roadmap

- **v0.2.0** (planned): Idempotency auto-prune, audit log API, multi-statement query, shell completion, CI integration test, npm publish automation.
- **v0.3.0** (exploratory): Web dashboard, HubSpot CSV importer, per-org rate limiting, encryption-at-rest.

---

## Versioning

Follows semantic versioning. Current: `0.1.0` (MVP).

---

## Build Info

- **Node**: >=20 (fetch, ESM, node: imports).
- **Build**: `pnpm build` → tsup → `dist/cli.js` + `dist/mcp.js` (ESM, shebang, minified).
- **Test**: `pnpm test` → vitest unit tests; `pnpm test:int` → integration (skipped without creds).
- **Package**: Single npm package, two bin entries, published to npm registry.
