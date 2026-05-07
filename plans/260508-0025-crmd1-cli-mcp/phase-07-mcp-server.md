# Phase 07 — MCP Server

## Context Links
- `plans/reports/researcher-260508-0025-agent-cli-mcp-patterns.md` (tool design, naming, schemas)
- `docs/system-architecture.md` (MCP topology)
- `docs/code-standards.md` (MCP must never log to stdout)

## Overview
- **Priority:** P1
- **Status:** complete
- Stdio MCP server registering narrow, intent-focused tools wrapping `core/crm/*`. Zod-derived schemas. Structured JSON outputs only.

## Key Insights
- MCP stdio = JSON-RPC over stdout. ANY console.log in core or libs corrupts protocol. Logger to stderr only is critical.
- Tool descriptions are agent-facing prompts; invest in 2-3 sentence descriptions with examples.
- Auth via env vars only: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CRMD1_ORG` (active org slug). No interactive flow in MCP.
- One MCP process = one org by default (set via `CRMD1_ORG` env). Optional `org` param on each tool to override.

## Requirements
- Bin `crmd1-mcp` starts stdio server.
- Tools (intent-focused, ~14):
  - Reads: `contact_search`, `contact_get`, `company_search`, `company_get`, `deal_search`, `deal_get`, `activity_list`, `task_list`, `crm_search`.
  - Writes: `contact_create`, `contact_update`, `company_create`, `company_update`, `deal_create`, `deal_update`, `activity_log`, `task_create`, `task_update`, `task_complete`, `entity_delete` (polymorphic soft-delete).
- Every write tool requires `idempotency_key`.
- Every list/search returns `{ items, next_cursor, count_estimate }`.
- Errors serialize to MCP `isError: true` content with structured JSON body.

## Architecture
```
src/mcp/server.ts   → createServer(): builds Server with Stdio transport, registers tools, lifecycle
src/mcp/tools.ts    → registerTools(server, ctx): all tool registrations
src/mcp/context.ts  → buildMcpContext(): config + D1Client + activeDbId from env
src/bin/crmd1-mcp.ts→ runs server
```

## Related Code Files

### To Create
- `src/mcp/server.ts`
- `src/mcp/tools.ts`
- `src/mcp/context.ts`
- `src/bin/crmd1-mcp.ts`
- `src/mcp/tools.test.ts`

## Implementation Steps

1. **bin/crmd1-mcp.ts** — shebang + `await (await import('../mcp/server.js')).start();`.
2. **mcp/context.ts** — read env, build config (env-only override path), construct D1Client, resolve active org. On missing required env, write structured error to stderr and exit 1 BEFORE creating server.
3. **mcp/server.ts**:
   - `import { Server } from '@modelcontextprotocol/sdk/server/index.js'`.
   - `import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'`.
   - Set name `crmd1-mcp`, version from package.json.
   - Register tools via `tools.ts`.
   - Connect to stdio.
4. **mcp/tools.ts** — `registerTools(server, ctx)`:
   - For each tool: `server.tool(name, description, zodSchema, async (input) => { ... })`.
   - Description format: 1-line purpose + when to use + example. ≤500 chars.
   - Wrap handler in try/catch; on `CrmdError` return `{ content: [{type:'text', text: JSON.stringify(err.toJSON())}], isError: true }`.
   - On success return `{ content: [{type:'text', text: JSON.stringify({ok:true, data})}] }`.
   - Tools accept optional `org` param; default to ctx.activeOrg.
5. **Tool list** — per requirements above. Reuse zod schemas from `core/validators.ts`. For polymorphic `entity_delete`, schema is `{ entity_type: enum, id: string, idempotency_key: string }`.
6. **Logging**: import `core/logger`; logger writes to stderr only. NEVER use `console.*` here.

## Todo List
- [x] bin/crmd1-mcp.ts entry
- [x] mcp/context.ts env-driven setup
- [x] mcp/server.ts stdio transport
- [x] mcp/tools.ts: 37 tools registered (split into tools/ subdirectory)
- [x] description copy tuned for LLM tool-calling (Block playbook: examples, when-not-to-use)
- [x] tests: assert tool names + schemas via invokeToolHandler
- [x] tests: call `contact_create` end-to-end against in-memory sqlite via D1Client mock

## Success Criteria
- `crmd1-mcp` survives `tools/list` + each tool invocation in test harness.
- No bytes ever written to stdout outside JSON-RPC frames.
- Each tool description includes purpose, when-to-use, example.
- Idempotency keys honored: replay returns identical body.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Stray console.log in dependency corrupts JSON-RPC | Medium | High | Audit transitive deps; wrap stdio in pre-flight check that fails if non-JSON detected. |
| Tool count too high → context bloat | Medium | Medium | Group narrowly; consider Tool Search if SDK supports; document recommended subset. |
| Schema drift between CLI flags and MCP params | Low | Medium | Both sourced from `core/validators.ts` zod schemas. |
| MCP SDK version churn (spec 2025-11-25) | Medium | Medium | Pin SDK version; smoke test on update. |

## Security
- No token in tool inputs/outputs. Env-only auth.
- Tool params validated by zod before any SQL.
- Server rejects unknown env (`CRMD1_*`) misuse via context guard.

## Next Steps
- Phase 08 adds tests covering both transports.
