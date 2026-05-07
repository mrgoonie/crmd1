# crmd1 — Product Development Requirements

## Vision

**crmd1** is a CLI + MCP server for AI agents to manage customer-relationship data stored in Cloudflare D1. One D1 database per organization. Agents (and humans) query/insert/search/modify/delete contacts, companies, deals, activities, and tasks through the same tool, exposed both as a `crmd1` CLI and as an MCP server (`crmd1-mcp`).

## Why

- AI agents need a stable, structured CRM interface. Cloud SaaS CRMs (HubSpot, Pipedrive) are too heavy / paid / not multi-tenant friendly for autonomous agents.
- Cloudflare D1 = free tier, SQLite under the hood, fully managed, REST API. One DB per org gives clean isolation at $0 cost up to small businesses.
- A dual-interface (CLI + MCP) keeps humans and agents on the same surface.

## Primary Users

1. **AI agents** (Claude, GPT, custom) — talking via MCP tools.
2. **Engineers/operators** — using the CLI to bootstrap orgs, inspect data, run migrations.

## Core Use Cases

| # | Actor | Use case |
|---|-------|----------|
| 1 | Operator | `crmd1 org create acme` → provisions a fresh D1 DB + applies CRM schema |
| 2 | Operator | `crmd1 org use acme` → switch active org for subsequent commands |
| 3 | Agent | MCP tool `contact_create` → insert contact with email + custom fields |
| 4 | Agent | MCP tool `crm_search "@acme.com"` → FTS5 search across contacts/companies/notes |
| 5 | Agent | MCP tool `deal_update` → move stage, recalc amount |
| 6 | Agent | MCP tool `activity_log` → polymorphic log against any entity |
| 7 | Operator | `crmd1 query "SELECT count(*) FROM contacts"` → escape hatch for raw SQL |

## Functional Requirements

- **F1** Multi-org: each org = one D1 DB; org→DB-id mapping persisted locally.
- **F2** Schema bootstrap: idempotent `db init` that applies DDL + FTS5 triggers.
- **F3** CRUD on 5 entities: `contacts`, `companies`, `deals`, `activities`, `tasks`.
- **F4** Search: full-text (FTS5) + structured filters + pagination cursor.
- **F5** Soft delete with restore + audit fields (`created_at`, `updated_at`, `deleted_at`).
- **F6** Custom fields via JSON column.
- **F7** Idempotency keys on all mutating operations.
- **F8** Dual transport: CLI subcommands ↔ MCP tools share core logic.
- **F9** Output: TTY → table; non-TTY or `--json` → JSON.
- **F10** Structured errors with stable codes for agent branching.

## Non-Functional Requirements

- **N1** No secrets in the repo. API token via env var or `~/.config/crmd1/config.json`.
- **N2** Cold-start CLI command < 200 ms (excluding network).
- **N3** Single-file binary distribution via `tsup` + Node 20+.
- **N4** All inputs validated via `zod` schemas (CLI args, MCP tool params, DB row shapes).
- **N5** Test coverage ≥ 70 % on `core/` (business logic).

## Out of Scope (v1)

- Web UI / mobile app.
- Real-time sync, webhooks, integrations (HubSpot/Pipedrive import/export).
- Multi-user permissions inside an org (single API token = full access).
- Background jobs / scheduled reminders.
- Encryption-at-rest beyond what D1 provides.

## Success Metrics

- Agent can complete the 7 core use cases via MCP tool calls without human intervention.
- Bootstrap a new org in < 30 seconds (`crmd1 org create X` returns ready DB).
- Round-trip `contact_create` → `crm_search` returns the contact within 1 second on warm DB.

## Open Questions

- Per-org rate limiting vs trusting Cloudflare quotas? (deferred — quotas are generous)
- Audit log table for every mutation? (deferred to v2)
