# crmd1 schema reference

All records carry `id` (UUID), `created_at`, `updated_at`, `deleted_at` (soft delete). Pagination is cursor-based via opaque `--cursor` tokens.

## contacts (customers / company members)
| Field | Notes |
|---|---|
| `email` | required, unique-ish |
| `first_name`, `last_name` | required |
| `phone`, `job_title` | optional |
| `company_id` | UUID — links to `companies`; presence = "company member" |
| `status` | `prospect | active | inactive | churned` |
| `notes_summary` | free text |
| `custom` | JSON object |

## companies (agencies / partners / customer accounts)
| Field | Notes |
|---|---|
| `name` | required |
| `domain` | e.g. `acme.com` |
| `industry` | free text — convention: `agency`, `partner`, `reseller`, etc. for segmentation |
| `employee_count` | integer |
| `status` | `active | inactive | prospect | churned` |
| `notes_summary` | free text |
| `custom` | JSON object |

## deals
| Field | Notes |
|---|---|
| `title` | required |
| `company_id` | required |
| `amount` | number |
| `stage` | `prospect | qualified | proposal | negotiation | closed_won | closed_lost` |
| `close_date` | YYYY-MM-DD |
| `probability` | 0–100 |
| `owner` | user ID |
| `contacts` | array of contact IDs (linked) |
| `notes_summary`, `custom` | as above |

## activities (append-only)
| Field | Notes |
|---|---|
| `entity_type` | `contact | company | deal` |
| `entity_id` | UUID of linked entity |
| `activity_type` | `call | email | meeting | note | task_completed | demo | follow_up | other` |
| `summary` | required free text |
| `next_follow_up_date` | YYYY-MM-DD |
| `metadata` | JSON object |

No update/restore commands — activities are immutable history.

## tasks
| Field | Notes |
|---|---|
| `title` | required |
| `due_date` | required, YYYY-MM-DD |
| `description` | free text |
| `entity_type` / `entity_id` | optional link (`contact | company | deal`) |
| `assigned_to` | user ID |
| `status` | `open | in_progress | completed | cancelled` |
| `priority` | `low | medium | high | urgent` |
| `custom` | JSON object |

## Indexing & search
SQLite FTS5 powers `crmd1 search`. Default searches all entity types; narrow via `--types contact,company,...`.
