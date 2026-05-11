# crmd1 CLI cheatsheet

Global flags: `--json`, `--token <t>`, `--account <id>`, `-v` / `-vv`, `-V` (version).

## Setup
| Command | Purpose |
|---|---|
| `crmd1 org create <slug>` | Create org + provision D1 database |
| `crmd1 org use <slug>` | Set active org |
| `crmd1 org current` | Show active org |
| `crmd1 org list` | List orgs |
| `crmd1 org delete <slug> [--drop]` | Remove org (optionally drop DB) |
| `crmd1 db init` | Run schema migrations |
| `crmd1 db version` | Schema version |
| `crmd1 db query <sql>` | Raw SQL (escape hatch) |

## Contacts (customers / members)
| Command | Required flags |
|---|---|
| `contact create` | `--email`, `--first-name`, `--last-name` |
| `contact get <id>` | — |
| `contact list` | filters: `--company-id`, `--q`, `--status`, `--limit`, `--cursor`, `--include-deleted` |
| `contact update <id>` | any of: `--email`, `--first-name`, `--last-name`, `--phone`, `--job-title`, `--company-id`, `--status`, `--notes`, `--custom`, `--idempotency-key` |
| `contact delete <id>` | soft delete |
| `contact restore <id>` | undo soft delete |

Status: `prospect|active|inactive|churned`.

## Companies (agencies / partners)
| Command | Required flags |
|---|---|
| `company create` | `--name` |
| `company list` | filters: `--domain`, `--status`, `--q`, `--limit`, `--cursor`, `--include-deleted` |
| `company update <id>` | `--name`, `--domain`, `--industry`, `--employee-count`, `--status`, `--notes`, `--custom` |
| `company delete <id>` | soft delete |
| `company restore <id>` | undo soft delete |

Status: `active|inactive|prospect|churned`. Convention: `--industry agency` / `--industry partner` to segment.

## Deals
| Command | Required flags |
|---|---|
| `deal create` | `--title`, `--company-id` |
| `deal list` | filters: `--stage`, `--company-id`, `--contact-id`, `--min-amount`, `--max-amount`, `--limit`, `--cursor`, `--include-deleted` |
| `deal update <id>` | `--title`, `--stage`, `--amount`, `--close-date`, `--probability`, `--owner`, `--notes`, `--custom` |
| `deal delete <id>` | soft delete |
| `deal restore <id>` | undo soft delete |

Stages: `prospect|qualified|proposal|negotiation|closed_won|closed_lost`. `--contacts` takes JSON array: `'["id1","id2"]'`.

## Activities (append-only — no update, no restore)
| Command | Required flags |
|---|---|
| `activity log` | `--entity-type`, `--entity-id`, `--type`, `--summary` |
| `activity list` | filters: `--entity-type`, `--entity-id`, `--type`, `--limit`, `--cursor`, `--include-deleted` |
| `activity delete <id>` | soft delete |

Entity types: `contact|company|deal`. Activity types: `call|email|meeting|note|task_completed|demo|follow_up|other`. Extras: `--follow-up <YYYY-MM-DD>`, `--metadata '{...}'`.

## Tasks
| Command | Required flags |
|---|---|
| `task create` | `--title`, `--due-date` |
| `task list` | filters: `--status`, `--assignee`, `--entity-type`, `--entity-id`, `--due-before`, `--due-after`, `--limit`, `--cursor`, `--include-deleted` |
| `task update <id>` | `--title`, `--description`, `--due-date`, `--status`, `--priority`, `--assigned-to`, `--entity-type`, `--entity-id`, `--custom` |
| `task complete <id>` | mark completed |
| `task delete <id>` | soft delete |
| `task restore <id>` | undo soft delete |

Status: `open|in_progress|completed|cancelled`. Priority: `low|medium|high|urgent`.

## Search
```sh
crmd1 search "<query>" [--types contact,company,deal,activity,task] [--limit 50] [--cursor <c>]
```

## Universal optional flags (create / log / update)
`--custom '<json>'` — custom fields (JSON object).
`--idempotency-key <key>` — safe retry.
