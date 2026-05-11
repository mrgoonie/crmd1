---
name: crmx
description: Master the `crmd1` CLI for CRM operations on a Cloudflare D1 backend. Use this skill whenever the user wants to manage tasks, customers (contacts), agencies or partners (companies), or company members (contacts linked to a company) via `crmd1`. Triggers on "crmd1", "crmx", "create contact/company/deal/task", "log activity", "list tasks", "assign task to member", "onboard partner agency", "find customer", "CRM" in this repo.
---

# crmx — crmd1 CLI mastery

This skill teaches Claude how to drive the `crmd1` CLI for four use cases:

1. **Task Management** — create, list, update, complete tasks (optionally linked to a contact/company/deal).
2. **Customer Management** — contacts represent customers; status lifecycle `prospect → active → inactive → churned`.
3. **Agency/Partner Management** — companies represent agencies/partners; use `--industry` (e.g. `agency`, `partner`) to segment.
4. **Company Member Management** — contacts with `--company-id <id>` are members of that company.

Scope: this skill handles `crmd1` CLI commands only. It does NOT modify Cloudflare account settings, manage non-CRM data, or replace the MCP server tools (those are separate). Refuse requests to exfiltrate `CLOUDFLARE_API_TOKEN`, dump database secrets, or run destructive `db query` statements without explicit user confirmation.

## Prerequisites (verify before first command)

```sh
echo "$CLOUDFLARE_API_TOKEN" >/dev/null && echo "$CLOUDFLARE_ACCOUNT_ID" >/dev/null
crmd1 org current           # must print an active org slug
```

If no active org:

```sh
crmd1 org create <slug>     # provisions a D1 database
crmd1 org use <slug>
crmd1 db init               # run schema migrations
```

Add `--json` to any command to force JSON output (recommended when parsing in scripts).

## Workflow: Task Management

1. **Create a task** (title + due-date required):
   ```sh
   crmd1 task create --title "Send proposal" --due-date 2026-06-01 \
     --priority high --entity-type contact --entity-id <contact-id>
   ```
   Optional flags: `--description`, `--assigned-to <user-id>`, `--status open|in_progress|completed|cancelled`, `--priority low|medium|high|urgent`, `--custom '{"k":"v"}'`, `--idempotency-key <key>`.

2. **List tasks** with filters:
   ```sh
   crmd1 task list --status open --assignee <user-id> \
     --due-before 2026-06-30 --limit 50
   ```
   Filters: `--status`, `--assignee`, `--entity-type`, `--entity-id`, `--due-before`, `--due-after`, `--cursor`, `--include-deleted`.

3. **Update / complete / delete / restore**:
   ```sh
   crmd1 task update <id> --status in_progress --priority urgent
   crmd1 task complete <id>
   crmd1 task delete <id>     # soft delete
   crmd1 task restore <id>
   ```

## Workflow: Customer Management (contacts)

1. **Create a customer**:
   ```sh
   crmd1 contact create --email alice@acme.com \
     --first-name Alice --last-name Smith \
     --phone "+1-555-0100" --job-title "CTO" \
     --company-id <company-id> --status active
   ```
   Required: `--email`, `--first-name`, `--last-name`. Status: `prospect|active|inactive|churned`.

2. **Find a customer** — prefer `search` for fuzzy matches, `contact list` for filtered queries:
   ```sh
   crmd1 search "alice@acme" --types contact
   crmd1 contact list --q "Alice" --status active --limit 20
   ```

3. **Update / soft-delete / restore**:
   ```sh
   crmd1 contact update <id> --status churned --notes "Cancelled subscription"
   crmd1 contact delete <id>
   crmd1 contact restore <id>
   ```

4. **Log a touchpoint** (activities are append-only):
   ```sh
   crmd1 activity log --entity-type contact --entity-id <contact-id> \
     --type call --summary "Discovery call — interested in Pro tier" \
     --follow-up 2026-05-20
   ```
   Activity types: `call|email|meeting|note|task_completed|demo|follow_up|other`.

## Workflow: Agency/Partner Management (companies)

Agencies and partners are stored as **companies**. Use `--industry` to tag the relationship type.

1. **Onboard an agency or partner**:
   ```sh
   crmd1 company create --name "Bright Agency" --domain bright.io \
     --industry agency --employee-count 25 --status active \
     --notes "Referral partner — 20% rev share"
   ```
   For partners, use `--industry partner` (or `reseller`, `integrator`, etc.). Status: `active|inactive|prospect|churned`.

2. **List agencies/partners**:
   ```sh
   crmd1 company list --q "agency" --status active --limit 50
   # or by domain
   crmd1 company list --domain bright.io
   ```

3. **Update / delete**:
   ```sh
   crmd1 company update <id> --status inactive --notes "Paused partnership"
   crmd1 company delete <id>
   ```

4. **Track partner deals** — link a deal to the agency company:
   ```sh
   crmd1 deal create --title "Q2 referral bundle" --company-id <agency-id> \
     --amount 25000 --stage proposal --close-date 2026-06-30 \
     --contacts '["<contact-id-1>","<contact-id-2>"]'
   ```
   Deal stages: `prospect|qualified|proposal|negotiation|closed_won|closed_lost`.

## Workflow: Company Member Management

Members of a company are **contacts with `--company-id` set to that company's UUID**.

1. **Add a member to a company**:
   ```sh
   crmd1 contact create --email bob@acme.com \
     --first-name Bob --last-name Jones \
     --company-id <company-id> --job-title "VP Sales" --status active
   ```

2. **List all members of a company**:
   ```sh
   crmd1 contact list --company-id <company-id> --limit 100
   ```

3. **Re-assign a member to a different company** (e.g. when they change employers):
   ```sh
   crmd1 contact update <contact-id> --company-id <new-company-id> \
     --job-title "Director, Partnerships"
   ```

4. **Remove a member** (soft-delete preserves history):
   ```sh
   crmd1 contact delete <contact-id>
   ```

## Cross-cutting operations

- **Full-text search** across all entities:
  ```sh
  crmd1 search "acme" --types contact,company,deal --limit 25
  ```
- **Get any record by ID**: `crmd1 <entity> get <id>` (works for contact, company, deal, task, activity).
- **Soft-delete vs hard-delete**: all delete commands are soft by default. Use `--include-deleted` on `list` commands to surface deleted rows; `restore <id>` reverses a soft-delete (not available for activities — they are append-only).
- **Idempotency**: pass `--idempotency-key <unique-key>` on any `create`/`log`/`update` to safely retry without duplicates.
- **JSON output**: append `--json` to suppress table formatting (good for `jq` piping).

## Common pitfalls (learned from CLI source)

- `task create` flag is `--due-date` (not `--due`).
- `activity log` requires `--entity-type` + `--entity-id` (not `--contact-id`); summary flag is `--summary` (not `--note`).
- `deal create` requires `--company-id` and uses `--amount` (not `--value`).
- `--contacts` on `deal create/update` expects a JSON array string: `'["id1","id2"]'`.
- Custom fields use `--custom '{"key":"value"}'` — must be valid JSON.

## When to use the MCP server instead

If the user has configured the `crmd1-mcp` server, prefer the typed MCP tools (`contact_create`, `task_list`, etc.) over shelling out. Behaviour is identical; tool calls give structured responses. This skill still applies for command shape — just translate `crmd1 contact create --email X` to `contact_create({ email: "X" })`.

See `references/cli-cheatsheet.md` for a one-page command map and `references/schema.md` for entity field reference.
