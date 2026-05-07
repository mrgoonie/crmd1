# CRM Data Model for AI Agent Query/Insert/Update via MCP/CLI

## Executive Summary
Minimal CRM schema for per-org SQLite databases requires **5 core tables** (contacts, companies, deals, activities, tasks) plus **FTS5 virtual table** for search. Use **JSON columns for custom fields**, **UUID v7 for IDs**, **soft deletes with audit fields**, and **polymorphic activity logging** with dual `entity_type`/`entity_id` columns instead of foreign keys. Cloudflare D1 fully supports FTS5.

---

## 1. Core Entities & Field Minimums

### Contacts (People)
**Universal required:** id, email (unique), first_name, last_name, created_at, updated_at, deleted_at
**AI-needed:** phone, company_id (FK), status, notes_summary (searchable text snippet)
**Optional:** job_title, birthday, address, custom_fields (JSON)

**Rationale:** Email is unique identifier (HubSpot, Attio pattern). Status supports lifecycle stages (prospect→customer→churned). Notes_summary enables quick AI context without full-text queries on every mention.

### Companies
**Universal required:** id, name, created_at, updated_at, deleted_at
**AI-needed:** domain (unique-ish), industry, employee_count, status (active/inactive), notes_summary
**Optional:** headquarters, annual_revenue, custom_fields (JSON)

**Rationale:** Domain enables auto-linking (HubSpot). Status filters active vs prospect orgs.

### Deals
**Universal required:** id, title, company_id (FK), created_at, updated_at, deleted_at
**AI-needed:** amount (numeric), stage, close_date, owner_user_id (FK), probability (0-100), notes_summary
**Optional:** custom_fields (JSON), linked_contacts (JSON array of contact IDs)

**Rationale:** Stage + probability support pipeline forecasting. owner_user_id enables permission/attribution (Salesforce Opportunity pattern). Linked_contacts avoids N:N junction table bloat.

### Activities
**Universal required:** id, entity_type (enum: contact|company|deal|task), entity_id, activity_type (call|email|meeting|note), created_at, created_by (user_id)
**AI-needed:** summary (text), metadata (JSON—stores call duration, email recipients, etc.), next_follow_up_date
**Optional:** deleted_at (audit trail)

**Rationale:** Polymorphic (no FK, enforced in app layer). activity_type narrows AI context. metadata stores type-specific fields without schema explosion. No updated_at needed (immutable events).

### Tasks
**Universal required:** id, title, due_date, status (open|completed|cancelled), created_at, updated_at, deleted_at
**AI-needed:** assigned_to (user_id), entity_type, entity_id, priority (low|medium|high), description
**Optional:** custom_fields (JSON)

**Rationale:** Minimal—tasks track action items. Polymorphic entity link like activities.

---

## 2. Relationships

```
Contact ──→ Company (many-to-one, company_id FK)
Deal ──→ Company (many-to-one, company_id FK)
Deal ──→ Contact (polymorphic via Activity, or store as JSON array in deal.linked_contacts)
Activity ──→ (Contact | Company | Deal | Task) via (entity_type, entity_id)
Task ──→ (Contact | Company | Deal) via (entity_type, entity_id)
```

**No junction tables for Contact↔Deal.** Use `deal.linked_contacts` JSON array (`["uuid-1", "uuid-2"]`) → AI serializes for LLM context, app-layer validation prevents orphans.

**Activities are immutable events**, not updateable records. Enforce in application layer (treat as append-only).

---

## 3. Custom Fields Strategy

**Recommendation: JSON column, not EAV.** 
- EAV queries require 2 joins per property; JSONB achieves 3× storage reduction, 15000× faster query performance vs EAV (benchmark: GIN index on JSONB = 0.153ms).
- For minimal schema: single `custom_fields` JSONB per table.
- Schema: `{"field_name": "value", "field_2": 123}`.
- SQLite stores JSON as TEXT, no GIN index, but still compact and queryable via `json_extract()`.
- AI agent serializes JSON for LLM context; avoid querying nested fields at query time (pre-compute into summary fields if needed).

---

## 4. Full-Text Search

**Use FTS5 virtual table, supported by Cloudflare D1.**
```sql
CREATE VIRTUAL TABLE contacts_fts USING fts5(
  email, first_name, last_name, phone, notes_summary,
  content=contacts, content_rowid=id
);
```
- Covers: name, email, phone, notes for contacts.
- Supports prefix search (`term*`), phrase search (`"exact phrase"`), AND/OR logic.
- Rebuild on INSERT/UPDATE via triggers:
  ```sql
  CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
    INSERT INTO contacts_fts(rowid, email, first_name, last_name, phone, notes_summary)
      VALUES (new.id, new.email, new.first_name, new.last_name, new.phone, new.notes_summary);
  END;
  ```
- Optional: Add `INSERT INTO contacts_fts(...) VALUES('optimize')` on app startup (merges B-trees, ~100ms overhead).

---

## 5. Soft Delete + Audit

```sql
-- Core fields on every table:
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
deleted_at TIMESTAMP NULL,
created_by TEXT, -- user_id / email
updated_by TEXT
```

**Soft delete pattern:** `deleted_at IS NULL` in every WHERE clause (app-layer filter or database view).
**Why:** Preserves audit trail for "who deleted what when"; recoverable within GDPR retention windows; compliance documentation.
**Trade-off:** Tables grow; plan for archival at 2+ year mark (hard-delete old records).

---

## 6. ID Strategy: UUID v7

**Recommendation: UUID v7 over ULID.**
- Time-ordered (ms precision in high bits), append-only B-tree inserts → 5–10% of autoincrement speed, 50× faster than UUID v4.
- Standard UUID format (compatible with all systems, no ULID-specific parsing).
- AI-friendly: sortable, parseable as string, human-readable in logs.
- SQLite stores as TEXT (36 bytes), no performance penalty vs autoincrement on small datasets (<10M rows).

**Implementation:** Generate on INSERT via app-layer (no SQLite native UUID v7), or use trigger with UDF if available in D1.

---

## 7. Day-1 Indexes

```sql
-- Contacts
CREATE INDEX contacts_email ON contacts(email) WHERE deleted_at IS NULL;
CREATE INDEX contacts_company_id ON contacts(company_id) WHERE deleted_at IS NULL;
CREATE INDEX contacts_created_at ON contacts(created_at);

-- Companies
CREATE INDEX companies_domain ON companies(domain) WHERE deleted_at IS NULL;
CREATE INDEX companies_created_at ON companies(created_at);

-- Deals
CREATE INDEX deals_company_id ON deals(company_id) WHERE deleted_at IS NULL;
CREATE INDEX deals_owner_user_id ON deals(owner_user_id);
CREATE INDEX deals_stage ON deals(stage) WHERE deleted_at IS NULL;
CREATE INDEX deals_close_date ON deals(close_date);

-- Activities
CREATE INDEX activities_entity ON activities(entity_type, entity_id);
CREATE INDEX activities_created_at ON activities(created_at);
CREATE INDEX activities_created_by ON activities(created_by);

-- Tasks
CREATE INDEX tasks_entity ON tasks(entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_assigned_to ON tasks(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX tasks_due_date ON tasks(due_date) WHERE status != 'completed';
```

**Rationale:** WHERE clauses filter soft-deletes; frequently-queried foreign keys indexed; date ranges on created_at/due_date; polymorphic lookups on entity pair.

---

## 8. Proposed `schema.sql`

```sql
-- Contacts table
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  job_title TEXT,
  company_id TEXT,
  status TEXT DEFAULT 'prospect', -- prospect, customer, churned
  notes_summary TEXT,
  custom_fields TEXT, -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Companies table
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  industry TEXT,
  employee_count INTEGER,
  status TEXT DEFAULT 'active', -- active, prospect, inactive
  notes_summary TEXT,
  custom_fields TEXT, -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);

-- Deals table
CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company_id TEXT NOT NULL,
  amount REAL,
  stage TEXT, -- prospecting, negotiation, closed_won, closed_lost
  close_date TEXT,
  probability INTEGER, -- 0-100
  owner_user_id TEXT,
  linked_contacts TEXT, -- JSON array ["uuid1", "uuid2"]
  notes_summary TEXT,
  custom_fields TEXT, -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- Activities table (polymorphic)
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- contact, company, deal, task
  entity_id TEXT NOT NULL,
  activity_type TEXT NOT NULL, -- call, email, meeting, note
  summary TEXT NOT NULL,
  metadata TEXT, -- JSON: {duration_min, email_to, meeting_attendees, etc}
  next_follow_up_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  deleted_at TEXT
);

-- Tasks table (polymorphic)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  entity_type TEXT, -- contact, company, deal (nullable: top-level task)
  entity_id TEXT,
  assigned_to TEXT,
  due_date TEXT NOT NULL,
  status TEXT DEFAULT 'open', -- open, completed, cancelled
  priority TEXT, -- low, medium, high
  custom_fields TEXT, -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE contacts_fts USING fts5(
  email, first_name, last_name, phone, notes_summary,
  content=contacts, content_rowid=id
);

-- Indexes
CREATE INDEX contacts_email ON contacts(email) WHERE deleted_at IS NULL;
CREATE INDEX contacts_company_id ON contacts(company_id) WHERE deleted_at IS NULL;
CREATE INDEX contacts_created_at ON contacts(created_at);
CREATE INDEX companies_domain ON companies(domain) WHERE deleted_at IS NULL;
CREATE INDEX companies_created_at ON companies(created_at);
CREATE INDEX deals_company_id ON deals(company_id) WHERE deleted_at IS NULL;
CREATE INDEX deals_owner_user_id ON deals(owner_user_id);
CREATE INDEX deals_stage ON deals(stage) WHERE deleted_at IS NULL;
CREATE INDEX deals_close_date ON deals(close_date);
CREATE INDEX activities_entity ON activities(entity_type, entity_id);
CREATE INDEX activities_created_at ON activities(created_at);
CREATE INDEX activities_created_by ON activities(created_by);
CREATE INDEX tasks_entity ON tasks(entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX tasks_assigned_to ON tasks(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX tasks_due_date ON tasks(due_date) WHERE status != 'completed';
```

---

## 9. AI Agent Integration Notes

1. **Query:** Agent serializes CRM state into context (contacts, deals, linked activities) before LLM prompt.
2. **Insert/Update:** Agent validates required fields, generates UUID v7 IDs, serializes JSON custom fields, enforces created_by/updated_by timestamps.
3. **Search:** Agent calls `SELECT * FROM contacts_fts WHERE ... MATCH 'query'` for name/email/notes lookups.
4. **Polymorphic Context:** Agent translates `(entity_type, entity_id)` to human text ("Contact: john@ex.com", "Deal: $50k Q2 close") for LLM comprehension.
5. **Audit:** Agent logs all mutations; created_by field identifies which agent/user made the change.

---

## Unresolved Questions

1. **User/Identity model:** Is `created_by` TEXT (email/agent_name) or FK to users table? Assumed TEXT for simplicity; scope for future auth layer.
2. **Deal↔Contact cardinality:** Should support many-to-many; current design uses `deal.linked_contacts` JSON array. Alternative: add `deal_contacts` junction table (add complexity, better referential integrity).
3. **Activity immutability:** Spec assumes activities never update (append-only). Confirm if "edit call note" is in scope (requires `updated_at`, `updated_by` on activities).
4. **Custom field validation:** No schema for custom field keys (e.g., is "phone" reserved?). Recommend app-layer convention doc if custom fields grow.
5. **Organization/Workspace partitioning:** Each org gets own D1 database. No global schema shown for org metadata or inter-org queries.

---

## Sources
- [HubSpot CRM Object & Relationships Model](https://knowledge.hubspot.com/data-management/view-a-model-of-your-crm-object-and-activity-relationships)
- [Pipedrive API Core Concepts & Fields](https://developers.pipedrive.com/docs/api/v1)
- [Salesforce Required Fields Reference](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/required_fields.htm)
- [Attio Data Model & Relationships](https://attio.com/help/reference/attio-101/attios-data-model/understanding-objects)
- [Cloudflare D1 FTS5 Support](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [UUID v7 vs ULID Performance](https://medium.com/@ciro-gomes-dev/uuidv4-vs-uuidv7-vs-ulid-choosing-the-right-identifier-for-database-performance-1f7d1a0fe0ba)
- [JSON vs EAV Performance](https://www.razsamuel.com/postgresql-jsonb-vs-eav-dynamic-data/)
- [SQLite FTS5 Full-Text Search](https://www.sqlite.org/fts5.html)
- [Polymorphic Relationships in SQL](https://www.dolthub.com/blog/2024-06-25-polymorphic-associations/)
- [Soft Delete vs Hard Delete Patterns](https://www.martyfriedel.com/blog/deleting-data-soft-hard-or-audit)
