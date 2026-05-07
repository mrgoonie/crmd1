# Project Roadmap

Track phases and milestones for crmd1 development.

---

## Phase 1: v0.1.0 — CLI + MCP MVP (Complete, 2026-05-08)

**Delivered** dual-interface CRM over per-org Cloudflare D1.

### Phases

| # | Name | Status |
|---|------|--------|
| 01 | Project setup (pnpm, tsconfig, biome, vitest, tsup) | ✓ |
| 02 | Core foundations (errors, ids, logger, config, validators) | ✓ |
| 03 | D1 client + org management | ✓ |
| 04 | Schema, migrations, db init | ✓ |
| 05 | CRM operations (contacts/companies/deals/activities/tasks/search) | ✓ |
| 06 | CLI (commander, output, commands) | ✓ |
| 07 | MCP server (stdio, tool registrations) | ✓ |
| 08 | Tests (vitest unit + integration + smoke) | ✓ |
| 09 | Build + package + README | ✓ |

### Capabilities

- **CLI**: 8 entity types with CRUD, search, org/db management.
- **MCP**: 37 tools for agents (Claude, others).
- **Data**: FTS5 search, soft delete, cursor pagination, idempotency.
- **Isolation**: Per-org D1 databases.

---

## Phase 2: v0.2.0 — Idempotency + Audit Log + Shell (Planned)

### Goals

- Clean up idempotency (`_crmd1_idempotency` auto-prune schedule).
- Audit log table (`_crmd1_audit`) for compliance.
- Multi-statement `db query` support (batch in transaction).
- CLI shell completion (bash/zsh).
- Real D1 integration test in CI/CD.
- npm publish on release tag.

### Effort

~12h

---

## Phase 3: v0.3.0 — Dashboard + Importers + Rate Limit (Exploratory)

### Goals

- Web dashboard (UI view of orgs/contacts/companies/deals).
- HubSpot CSV importer (bulk contact sync).
- Per-org rate limiting (configurable req/min).
- Encryption at rest beyond D1 defaults.

### Effort

~20h

---

## Success Metrics (v0.1.0)

- ✓ 7 PDR use cases pass via CLI + MCP.
- ✓ `pnpm test` green; >70% coverage in core.
- ✓ `pnpm build` produces working `dist/cli.js` + `dist/mcp.js`.
- ✓ `npx crmd1 org create <name>` provisions D1 + applies schema in <30s.

---

## Known Limitations (v0.1.0)

- **Idempotency cleanup**: Manual via `crmd1 db query` (v0.2 adds auto-prune schedule).
- **Audit log**: Logged to `_crmd1_audit` table; not exposed via API yet (v0.2 feature).
- **Multi-statement queries**: Single statement only; `db query` rejects `;` unless `--allow-multi` (safer default for v0.1).
- **Rate limiting**: None; per-org limit planned (v0.3).
- **Dashboard**: CLI only for v0.1; web UI planned (v0.3).

---

## Architecture Decisions

- **ESM only**: Node 20+, no CJS compat needed.
- **Single package**: Two bins (crmd1, crmd1-mcp) in one npm publish.
- **No shared backend**: Per-org D1 isolation replaces traditional multi-tenant DB.
- **Hand-rolled SQL**: No ORM; parameterized via D1 REST; FTS5 for search.
- **Idempotency first**: All mutations keyed for replay safety.

---

## Links

- PDR: `docs/project-overview-pdr.md`
- Architecture: `docs/system-architecture.md`
- Code standards: `docs/code-standards.md`
- Changelog: `docs/project-changelog.md`
