# crmd1

A CLI and MCP server for a Cloudflare D1-backed CRM — built for AI agents and humans alike.

[![npm version](https://img.shields.io/npm/v/crmd1)](https://www.npmjs.com/package/crmd1)
[![license](https://img.shields.io/npm/l/crmd1)](./LICENSE)
[![node](https://img.shields.io/node/v/crmd1)](https://nodejs.org)

---

## Why crmd1

- **Serverless storage**: each organization gets its own isolated Cloudflare D1 (SQLite) database — no shared infrastructure to manage.
- **Agent-native**: all operations are exposed as typed MCP tools consumable by Claude, any LLM agent, or custom automation without needing a REST API.
- **Human-friendly CLI**: the same operations available to agents are available interactively via `crmd1` with table output and clear error messages.

---

## Install

```sh
npm i -g crm-d1
```

Or run without installing:

```sh
npx crm-d1 --help
```

### Claude Code Plugin

Enhance Claude's ability to drive the CLI:

```
/plugin marketplace add mrgoonie/crmd1
/plugin install crmx@crmd1
```

See [`plugins/crmx/README.md`](./plugins/crmx/README.md) for details on the `crmx` skill.

---

## Quick start

### 1. Set environment variables

```sh
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
```

Or store them in a `.env` file in the working directory.

### 2. Create an organization and initialize the database

```sh
crmd1 org create acme
crmd1 org use acme
crmd1 db init
```

### 3. Add contacts and search

```sh
crmd1 contact create --email a@b.com --first-name Alice --last-name Smith
crmd1 search "@b.com"
```

### 4. Full example

```sh
crmd1 company create --name "Acme Corp" --domain acme.com
crmd1 contact create --email bob@acme.com --company-id <id>
crmd1 deal create --title "Enterprise deal" --value 50000 --contact-id <id>
crmd1 activity log --type call --note "Intro call done" --contact-id <id>
crmd1 task create --title "Send proposal" --due 2026-06-01 --contact-id <id>
crmd1 contact list --limit 20
```

---

## Use as MCP server

Add `crmd1-mcp` to your MCP client configuration. Example for Claude Desktop or any generic MCP client:

```jsonc
{
  "mcpServers": {
    "crmd1": {
      "command": "npx",
      "args": ["-y", "crmd1-mcp"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "...",
        "CLOUDFLARE_ACCOUNT_ID": "..."
      }
    }
  }
}
```

The server communicates over stdio using the MCP protocol. Restart your client after editing the config.

---

## Tools exposed (37 total)

### Org & DB
- `org_create` — create a new organization (provisions a D1 database)
- `org_list` — list all organizations
- `org_use` — set the active organization
- `org_current` — show the active organization
- `org_delete` — delete an organization
- `db_init` — run schema migrations on the active org's database
- `db_query` — execute a raw SQL SELECT on the active org's database
- `crm_search` — full-text search across contacts, companies, deals, activities, and tasks

### Contacts
- `contact_create` — create a contact
- `contact_get` — get a contact by ID
- `contact_list` — list contacts with pagination and filters
- `contact_update` — update contact fields
- `contact_delete` — soft-delete a contact
- `contact_restore` — restore a soft-deleted contact

### Companies
- `company_create` — create a company
- `company_get` — get a company by ID
- `company_list` — list companies with pagination and filters
- `company_update` — update company fields
- `company_delete` — soft-delete a company
- `company_restore` — restore a soft-deleted company

### Deals
- `deal_create` — create a deal
- `deal_get` — get a deal by ID
- `deal_list` — list deals with pagination and filters
- `deal_update` — update deal fields (stage, value, etc.)
- `deal_delete` — soft-delete a deal
- `deal_restore` — restore a soft-deleted deal

### Activities
- `activity_log` — log an activity (call, email, meeting, note)
- `activity_get` — get an activity by ID
- `activity_list` — list activities for a contact, company, or deal
- `activity_delete` — delete an activity

### Tasks
- `task_create` — create a task
- `task_get` — get a task by ID
- `task_list` — list tasks with filters
- `task_update` — update task fields
- `task_complete` — mark a task as complete
- `task_delete` — soft-delete a task
- `task_restore` — restore a soft-deleted task

---

## Multi-org

Each organization maps to one Cloudflare D1 database. The active organization is stored in the local config (`~/.config/crmd1/config.json` or `CRMD1_CONFIG_PATH`). Switch at any time:

```sh
crmd1 org use other-org
```

All CLI commands and MCP tool calls operate against the active organization's database.

---

## Schema

Five core entities with full-text search via SQLite FTS5:

| Entity | Key fields |
|--------|-----------|
| `contacts` | id, first_name, last_name, email, phone, company_id |
| `companies` | id, name, domain, industry |
| `deals` | id, title, value, stage, contact_id, company_id |
| `activities` | id, type, note, contact_id, company_id, deal_id |
| `tasks` | id, title, due_date, completed_at, contact_id, deal_id |

All records carry `created_at`, `updated_at`, and `deleted_at` (soft delete). Pagination uses opaque cursor tokens.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLOUDFLARE_API_TOKEN` | Yes | Cloudflare API token with D1 read/write permission |
| `CLOUDFLARE_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `CRMD1_ORG` | No | Override the active organization name |
| `CRMD1_CONFIG_PATH` | No | Override config file location |

---

## Development

```sh
git clone https://github.com/mrgoonie/crmd1.git
cd crmd1
pnpm i
pnpm test
pnpm build
node dist/cli.js --help
```

Run tests with coverage:

```sh
pnpm test:coverage
```

Typecheck:

```sh
pnpm typecheck
```

---

## Architecture

See [docs/system-architecture.md](./docs/system-architecture.md) for the full design: module boundaries, D1 adapter interface, MCP transport layer, and CLI command tree.

---

## License

MIT. See [LICENSE](./LICENSE).
