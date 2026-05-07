# Design Guidelines

This document covers CLI UX conventions and MCP tool description style for crmd1 (no UI).

---

## CLI UX Conventions

### Command Structure
Commands follow **hierarchical subcommand pattern**: `crmd1 <entity> <action> [flags]`

**Entity groups**:
- `org` — organization lifecycle (create, list, use, current, delete)
- `db` — database operations (init, query, migrate)
- `contact`, `company`, `deal`, `activity`, `task` — CRUD on entities
- `search` — full-text search across all entities

### Action Naming
- **Create**: `crmd1 contact create --email a@b.com --first-name Alice`
- **Get**: `crmd1 contact get <id>` (positional)
- **List**: `crmd1 contact list --limit 50 --cursor <token>` (with pagination)
- **Update**: `crmd1 contact update <id> --email new@b.com` (positional id, optional flags)
- **Delete**: `crmd1 contact delete <id>` (soft-delete)
- **Restore**: `crmd1 contact restore <id>` (undo soft-delete)

### Flag Style
- **Boolean flags**: `--json`, `--include-deleted` (no value)
- **String/numeric flags**: `--email value`, `--limit 50`
- **Optional parameters**: `--phone "+1-555-..." --company-id <uuid>`
- **Idempotency**: `--idempotency-key <string>` (optional on mutations, for retry safety)

Use `--help` / `-h` for per-command reference; `-v` / `--version` for app version.

### Output Formatting
- **TTY (interactive terminal)**: Pretty-printed table via `cli-table3` with aligned columns, dim audit fields
- **Non-TTY** (pipe, redirect, CI): `--json` always valid; use `--json` explicitly or infer from isatty()
- **Error format (both modes)**: 
  ```json
  {
    "ok": false,
    "error": {
      "code": "CONFLICT",
      "message": "Email already in use",
      "retryable": false,
      "details": { "field": "email" }
    }
  }
  ```

### Example Outputs

**Table output** (TTY):
```
┌────────────────────┬────────────┬──────────────┐
│ id                 │ email      │ created_at   │
├────────────────────┼────────────┼──────────────┤
│ 01acv...(short)    │ a@b.com    │ 2026-05-08   │
│ 01acw...           │ c@d.com    │ 2026-05-07   │
└────────────────────┴────────────┴──────────────┘
```

**JSON output** (non-TTY):
```json
{
  "ok": true,
  "data": {
    "items": [
      { "id": "01acv...", "email": "a@b.com", "created_at": "2026-05-08T..." }
    ],
    "next_cursor": "...",
    "total_estimate": 2
  }
}
```

### Exit Codes
- `0` — Success
- `1` — User error (e.g., invalid flag, missing required arg)
- `2` — Authentication/auth error (missing token, org not found)
- `3` — Network error (D1 unreachable)
- `4` — Unknown/internal error

### Org Switching
The active org is stored in `~/.config/crmd1/config.json`. All operations default to the active org:
```bash
crmd1 org use acme        # Switch to 'acme' org
crmd1 contact list        # Operates on acme's database
crmd1 org use other       # Switch to 'other' org
crmd1 contact list        # Now operates on other's database
```

Override with env var: `CRMD1_ORG=acme crmd1 contact list`

---

## MCP Tool Description Style Guide

### Anatomy of a Tool Definition

**Location**: `src/mcp/tools/*.ts`

**Pattern**:
```typescript
server.tool(
  'tool_name',
  'One-line human-readable description explaining what this tool does.',
  z.object({
    param1: z.string().describe('What param1 is and how it's used.'),
    param2: z.number().optional().describe('Optional. When to use this.'),
  }),
  async (input, ctx) => {
    // implementation
  },
);
```

### Description Rules

1. **First line** (description): Action-oriented, no period, lowercase start, ~80 chars max
   - ✅ `create a new contact with email and basic fields`
   - ✅ `search across contacts, companies, deals, activities, tasks using full-text search`
   - ❌ `Contact creation tool` (vague)
   - ❌ `This tool creates contacts.` (passive, period)

2. **Field descriptions** (.describe()): Clarify range, format, constraints, defaults
   - ✅ `email address (RFC 5321); must be unique per organization`
   - ✅ `list limit, 1–100, default 50`
   - ✅ `opaque cursor from previous list response; omit for first page`
   - ❌ `email` (no context)
   - ❌ `the contact email address` (redundant with field name)

3. **Optional field**: Always `.describe()` with "Optional. When/why to use this."
   - ✅ `Optional. Job title (max 255 chars).`
   - ✅ `Optional. If provided, links contact to company.`

4. **Idempotency key**: Present on all mutations
   - Describe as: `Optional. Idempotency key for retry safety (24h TTL); same key replays the stored response.`

### Grouping by Entity

Tools are registered in entity-specific files (`org-tools.ts`, `contact-tools.ts`, etc.) with a `registerXxxTools()` function. Keep tools for the same entity in one file; tool names use entity prefix.

**Naming convention**: `{entity}_{action}`
- `contact_create`, `contact_get`, `contact_list`, `contact_update`, `contact_delete`, `contact_restore`
- `org_create`, `org_use`, `org_current`, `org_delete`

### Return Value Convention

All tool responses follow the shape:
```typescript
{
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        ok: true,
        data: { /* result */ }
      })
    }
  ]
}
```

Or on error:
```typescript
{
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        ok: false,
        error: {
          code: 'ERROR_CODE',
          message: 'human-readable message',
          retryable: false,
          details: { /* optional */ }
        }
      })
    }
  ],
  isError: true
}
```

### Error Documentation

If a tool has known error cases, document in description or separate note:
- `CONFLICT` — Email already in use
- `NOT_FOUND` — Contact not found by ID
- `DB_INIT_REQUIRED` — Organization database not initialized (run `db_init` first)
- `INVALID_INPUT` — Validation failed (details.issues lists field paths)
- `RATE_LIMIT` — Cloudflare rate limit hit (retryable with exponential backoff)

---

## Pagination Style

All list tools return:
```json
{
  "ok": true,
  "data": {
    "items": [ /* entity objects */ ],
    "next_cursor": "optional opaque token for next page",
    "total_estimate": 1000
  }
}
```

- **Cursor**: Opaque base64url token; don't expose internal structure to users
- **No offset-based pagination**: Prevents issues with concurrent writes
- **Limit**: 1–100, default 50
- **Example usage**:
  ```bash
  crmd1 contact list --limit 20
  crmd1 contact list --limit 20 --cursor <next_cursor>
  ```

---

## Filters & Search

### Structured Filters
List endpoints accept optional filters:
- `contact list --company-id <uuid>` — Filter by company
- `contact list --email alice@b.com` — Exact email match
- `contact list --status active` — Filter by status enum
- `contact list --include-deleted` — Include soft-deleted records (default: exclude)

### Full-Text Search
`crm_search` tool:
- Input: `q` (required), `entity_type` (optional), `limit`, `cursor`
- Returns all matching entities (contacts, companies, deals, activities, tasks)
- Example: `crm_search "@b.com"` finds all contacts + companies with @b.com in indexed fields

---

## Audit Fields (Read-Only)

Every entity includes:
- `created_at` — ISO 8601 timestamp (UTC)
- `updated_at` — ISO 8601 timestamp (UTC)
- `deleted_at` — Nullable; if set, entity is soft-deleted
- `created_by` — Optional; user/agent identifier (if provided at creation)
- `updated_by` — Optional; user/agent identifier (if provided at update)

These fields are **never** returned in CLI table by default (shown with `--json` or on-demand). MCP returns all fields always.

---

## Soft Delete Convention

Soft-deleted records:
- Are excluded from `list()` by default (add `--include-deleted` to see them)
- Can still be queried by ID via `get()`
- Can be restored via `restore()` action
- Are hard-deleted via `delete()` on an already soft-deleted record (not exposed in v0.1.0)

---

## Input Validation

All inputs validated via Zod at the boundary:
- **CLI**: `src/cli/commands/*.ts` parse flags → call core CRUD → serialize error if CrmdError(INVALID_INPUT, ...)
- **MCP**: `src/mcp/tools/*.ts` receive input, pass to core, serialize error

Validation errors return `INVALID_INPUT` with `details.issues`:
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Validation failed: ...",
    "details": {
      "issues": [
        { "path": "email", "message": "Invalid email address" },
        { "path": "limit", "message": "Must be between 1 and 100" }
      ]
    }
  }
}
```

---

## Idempotency Keys

Mandatory on all mutations (create, update, delete, restore):
- **CLI**: `--idempotency-key <string>` (optional; if omitted, operation is *not* idempotent)
- **MCP**: `idempotency_key` (optional in schema; recommended)
- **TTL**: 24 hours from creation
- **Scope**: Per operation (e.g., `contact.create:key-123` vs `deal.create:key-123` are distinct)

Use case: Agent retries after network timeout — same key returns cached result.

---

## Custom Fields

All entities support a `custom_fields` JSON object:
```bash
crmd1 contact create --email a@b.com --first-name Alice \
  --custom-fields '{"segment":"vip","mrr":5000}'
```

MCP equivalent:
```json
{
  "email": "a@b.com",
  "first_name": "Alice",
  "custom_fields": { "segment": "vip", "mrr": 5000 }
}
```

Custom fields are **never** validated; they're opaque to the system. Agents can extend without schema changes.

---

## Schema Evolution

v0.1.0 ships with fixed schema. Future versions will add:
- Per-org custom field schema (type hints, validation)
- Audit log table (every mutation recorded)
- Per-org rate limits
- Bulk operations (batch insert/update)

Do **not** hard-code assumptions about field order or presence in responses. Use `.field_name` notation in JSON paths.

---

*Last updated: 2026-05-08 for v0.1.0 release.*
