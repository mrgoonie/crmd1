/**
 * CRM schema SQL exported as a TypeScript string constant.
 * Embedded here so tsup bundles it cleanly without needing a .sql text loader.
 * Source of truth: src/core/schema.sql — keep in sync.
 */

export const SCHEMA_SQL = `
-- CRM schema for Cloudflare D1 (SQLite-compatible)
-- Version: 1

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  industry TEXT,
  employee_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  notes_summary TEXT,
  custom_fields TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  job_title TEXT,
  company_id TEXT,
  status TEXT NOT NULL DEFAULT 'prospect',
  notes_summary TEXT,
  custom_fields TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company_id TEXT NOT NULL,
  amount REAL,
  stage TEXT,
  close_date TEXT,
  probability INTEGER,
  owner_user_id TEXT,
  linked_contacts TEXT,
  notes_summary TEXT,
  custom_fields TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata TEXT,
  next_follow_up_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  entity_type TEXT,
  entity_id TEXT,
  assigned_to TEXT,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT,
  custom_fields TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT,
  created_by TEXT,
  updated_by TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS crm_search USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  body,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS contacts_updated_at
AFTER UPDATE ON contacts
BEGIN
  UPDATE contacts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS companies_updated_at
AFTER UPDATE ON companies
BEGIN
  UPDATE companies SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS deals_updated_at
AFTER UPDATE ON deals
BEGIN
  UPDATE deals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tasks_updated_at
AFTER UPDATE ON tasks
BEGIN
  UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS contacts_fts_ai
AFTER INSERT ON contacts
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'contact', NEW.id,
    COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'') || ' ' ||
    COALESCE(NEW.email,'') || ' ' || COALESCE(NEW.phone,'') || ' ' ||
    COALESCE(NEW.notes_summary,'')
  );
END;

-- Update (edit): both rows non-deleted — refresh FTS body
CREATE TRIGGER IF NOT EXISTS contacts_fts_au_edit
AFTER UPDATE ON contacts
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'contact' AND entity_id = OLD.id;
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'contact', NEW.id,
    COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'') || ' ' ||
    COALESCE(NEW.email,'') || ' ' || COALESCE(NEW.phone,'') || ' ' ||
    COALESCE(NEW.notes_summary,'')
  );
END;

-- Soft-delete: remove from FTS index
CREATE TRIGGER IF NOT EXISTS contacts_fts_au_softdel
AFTER UPDATE ON contacts
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'contact' AND entity_id = OLD.id;
END;

-- Restore: re-add to FTS index
CREATE TRIGGER IF NOT EXISTS contacts_fts_au_restore
AFTER UPDATE ON contacts
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'contact', NEW.id,
    COALESCE(NEW.first_name,'') || ' ' || COALESCE(NEW.last_name,'') || ' ' ||
    COALESCE(NEW.email,'') || ' ' || COALESCE(NEW.phone,'') || ' ' ||
    COALESCE(NEW.notes_summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS contacts_fts_ad
AFTER DELETE ON contacts
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'contact' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS companies_fts_ai
AFTER INSERT ON companies
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'company', NEW.id,
    COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.domain,'') || ' ' ||
    COALESCE(NEW.industry,'') || ' ' || COALESCE(NEW.notes_summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS companies_fts_au_edit
AFTER UPDATE ON companies
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'company' AND entity_id = OLD.id;
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'company', NEW.id,
    COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.domain,'') || ' ' ||
    COALESCE(NEW.industry,'') || ' ' || COALESCE(NEW.notes_summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS companies_fts_au_softdel
AFTER UPDATE ON companies
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'company' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS companies_fts_au_restore
AFTER UPDATE ON companies
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'company', NEW.id,
    COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.domain,'') || ' ' ||
    COALESCE(NEW.industry,'') || ' ' || COALESCE(NEW.notes_summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS companies_fts_ad
AFTER DELETE ON companies
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'company' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS deals_fts_ai
AFTER INSERT ON deals
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'deal', NEW.id,
    COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.stage,'') || ' ' ||
    COALESCE(NEW.notes_summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS deals_fts_au_edit
AFTER UPDATE ON deals
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'deal' AND entity_id = OLD.id;
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'deal', NEW.id,
    COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.stage,'') || ' ' ||
    COALESCE(NEW.notes_summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS deals_fts_au_softdel
AFTER UPDATE ON deals
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'deal' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS deals_fts_au_restore
AFTER UPDATE ON deals
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'deal', NEW.id,
    COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.stage,'') || ' ' ||
    COALESCE(NEW.notes_summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS deals_fts_ad
AFTER DELETE ON deals
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'deal' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS activities_fts_ai
AFTER INSERT ON activities
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'activity', NEW.id,
    COALESCE(NEW.activity_type,'') || ' ' || COALESCE(NEW.summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS activities_fts_au_edit
AFTER UPDATE ON activities
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'activity' AND entity_id = OLD.id;
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'activity', NEW.id,
    COALESCE(NEW.activity_type,'') || ' ' || COALESCE(NEW.summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS activities_fts_au_softdel
AFTER UPDATE ON activities
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'activity' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS activities_fts_au_restore
AFTER UPDATE ON activities
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'activity', NEW.id,
    COALESCE(NEW.activity_type,'') || ' ' || COALESCE(NEW.summary,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS activities_fts_ad
AFTER DELETE ON activities
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'activity' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_ai
AFTER INSERT ON tasks
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'task', NEW.id,
    COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_au_edit
AFTER UPDATE ON tasks
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'task' AND entity_id = OLD.id;
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'task', NEW.id,
    COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_au_softdel
AFTER UPDATE ON tasks
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'task' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_au_restore
AFTER UPDATE ON tasks
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO crm_search(entity_type, entity_id, body)
  VALUES (
    'task', NEW.id,
    COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,'')
  );
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_ad
AFTER DELETE ON tasks
BEGIN
  DELETE FROM crm_search WHERE entity_type = 'task' AND entity_id = OLD.id;
END;

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at);
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_companies_created_at ON companies(created_at);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_close_date ON deals(close_date);
CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at);
CREATE INDEX IF NOT EXISTS idx_activities_created_by ON activities(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_entity ON tasks(entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE status != 'completed';

CREATE TABLE IF NOT EXISTS _crmd1_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO _crmd1_meta(key, value) VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS _crmd1_idempotency (
  key TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS _migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;
