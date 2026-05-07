---
title: "crmd1 — CLI + MCP server for Cloudflare D1 CRM"
description: "Phased implementation of dual-interface CRM (CLI + MCP) backed by per-org Cloudflare D1 databases."
status: complete
priority: P1
effort: ~32h
branch: main
tags: [cli, mcp, cloudflare-d1, crm, typescript]
created: 2026-05-08
---

## Overview

Build `crmd1` (CLI) + `crmd1-mcp` (MCP server) over Cloudflare D1 REST. One D1 DB per org. Pure `core/` layer reused by both transports. Validation via zod, IDs via uuid v7, hand-rolled parameterized SQL, FTS5 search, soft delete, idempotency keys.

Reference docs:
- `docs/project-overview-pdr.md`
- `docs/system-architecture.md`
- `docs/code-standards.md`

Reference research:
- `plans/reports/researcher-260508-0025-cloudflare-d1-access.md`
- `plans/reports/researcher-260508-0025-crm-data-model.md`
- `plans/reports/researcher-260508-0025-agent-cli-mcp-patterns.md`

## Phases

| # | Phase | File | Status | Effort |
|---|-------|------|--------|--------|
| 01 | Project setup (pnpm, tsconfig, biome, vitest, tsup) | [phase-01-project-setup.md](phase-01-project-setup.md) | [x] complete | 2h |
| 02 | Core foundations (errors, ids, logger, config, validators) | [phase-02-core-foundations.md](phase-02-core-foundations.md) | [x] complete | 3h |
| 03 | D1 client + org management | [phase-03-d1-client.ts.md](phase-03-d1-client.ts.md) | [x] complete | 3h |
| 04 | Schema, migrations, db init | [phase-04-schema-and-db-init.md](phase-04-schema-and-db-init.md) | [x] complete | 3h |
| 05 | CRM operations (contacts/companies/deals/activities/tasks/search) | [phase-05-crm-operations.md](phase-05-crm-operations.md) | [x] complete | 6h |
| 06 | CLI (commander, output, commands) | [phase-06-cli.md](phase-06-cli.md) | [x] complete | 5h |
| 07 | MCP server (stdio, tool registrations) | [phase-07-mcp-server.md](phase-07-mcp-server.md) | [x] complete | 4h |
| 08 | Tests (vitest unit + integration + smoke) | [phase-08-tests.md](phase-08-tests.md) | [x] complete | 4h |
| 09 | Build + package + README | [phase-09-build-and-package.md](phase-09-build-and-package.md) | [x] complete | 2h |

## Dependency Graph

```
01 → 02 → 03 → 04 → 05 → 06 ┐
                          └→ 07 → 08 → 09
```

Phase 06 and 07 can run in parallel after 05. Phase 08 can begin partial coverage as 02-05 land.

## Cross-Phase Constraints

- `core/` MUST NOT import `cli/` or `mcp/`.
- All files ≤ 200 LOC.
- All inputs validated via zod at boundaries.
- All SQL parameterized; never string-concat input.
- IDs: uuid v7 via `uuidv7` package.
- Soft delete: `deleted_at IS NULL` filter on every read.
- Idempotency keys honored on all mutations.
- Bins: `crmd1`, `crmd1-mcp`. Package manager: pnpm.

## Rollback

Each phase is additive on a feature branch. Revert by reverting the phase commit; downstream phases hold their own tests so regressions surface fast.

## Success Criteria

- 7 PDR use cases pass via CLI and MCP.
- `pnpm test` green; ≥70% coverage in `core/`.
- `pnpm build` produces working `dist/cli.js` + `dist/mcp.js`.
- `npx crmd1 org create demo` provisions D1 + applies schema in <30s.
