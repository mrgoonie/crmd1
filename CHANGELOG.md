# Changelog

## 0.1.0 — 2026-05-08

- Initial release. CLI (`crmd1`) + MCP server (`crmd1-mcp`).
- 37 MCP tools across contacts/companies/deals/activities/tasks/search/org/db.
- Per-organization Cloudflare D1 isolation. FTS5 search. Soft delete + idempotency.

### Known limitations

- `_crmd1_idempotency` rows are not pruned automatically; clean periodically with
  `DELETE FROM _crmd1_idempotency WHERE created_at < datetime('now','-1 day')` via `crmd1 db query`.
  Scheduled auto-cleanup is tracked for v0.2.
- Soft-delete FTS regression test added in v0.1.0 (`search.test.ts`).
