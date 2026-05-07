# Dual-Interface CLI for CRM: MCP + Human CLI Best Practices

## Executive Summary
Build a single core logic layer exposed as CLI subcommands (human REPL + scripts) AND MCP server tools (AI agents). Separate transport from business logic; share validation & error handling. Prefer narrow, intent-focused MCP tools over broad queries; rely on tool search for discoverability.

---

## 1. Dual-Interface Architecture

**Pattern: Shared Core, Separate Transports**
- Single business-logic layer (domain models, DB queries, validation)
- CLI transport: `commander` (0 deps, Git-style subcommands) or `yargs` (powerful parsing, 16 deps)
- MCP transport: `@modelcontextprotocol/sdk` (TypeScript, JSON-RPC 2.0 over stdio)
- Each transport wraps core with its own input/output serialization

**Recommendation:** Use `commander` for CLI. It's lean, declarative, and explicitly designed for subcommand hierarchies. MCP is independent server binary.

**Error Handling:** Both transports convert errors to structured JSON on output:
```json
{ "error": "CONTACT_NOT_FOUND", "message": "...", "retryable": false }
```

---

## 2. Output Formatting: Human vs. Machine

**TTY Detection Rule:**
- `isatty(stdout)` → pretty tables, colors, summaries (human-friendly)
- Piped/non-TTY → `--json` by default, fallback to `--output <format>`
- CLI flag: `--json` overrides TTY detection

**MCP Tools:** Always return JSON (agents parse JSON natively). Include structured metadata:
```json
{
  "data": [...],
  "metadata": {
    "count": 42,
    "next_cursor": "c_...",
    "truncated": false,
    "source": "D1"
  }
}
```

**Example:** `crm contacts list --limit 10` → table for human, `--json` → JSON array for agent.

---

## 3. Idempotency & Deterministic IDs

**Pattern:** Deterministic idempotency keys from workflow context, not execution time.
- Client supplies `--idempotency-key <uuid>` (human CLI optional, MCP agents MUST include)
- Server dedupes within 24h window; returns original result on retry
- Key generation: hash(workflow_id, step_index, action_type)—NOT timestamp

**Deterministic Output:** Same query → same result order (use LIMIT + explicit ORDER BY in D1 SQL)

**Exit/Error Codes:** Define enum (e.g., `CONTACT_NOT_FOUND=404`, `DB_ERROR=500`, `RETRY_SAFE=429`)

---

## 4. MCP Tool Design

**Tool Naming:** `<domain>_<action>` (e.g., `contact_search`, `deal_create`)
- Avoid snake_case inconsistency; be explicit
- Names appear in tool search results; clarity matters

**Tool Count Doctrine:** Narrow > Broad. Don't mirror your API 1:1.
- Bad: `get_contact`, `list_contacts`, `search_contacts`, `filter_contacts` (4 tools, confusing)
- Good: `contact_search` (single flexible tool with filters, limit, cursor)
- Tradeoff: Single tool = fewer decisions for agent, but less semantic clarity than intent-specific tools

**Schema + Defaults:** Every param should have:
- Description (2-3 sentences; examples in description if complex)
- Type + enum hints where possible (e.g., `status: "active" | "inactive" | "archived"`)
- Defaults (e.g., `limit: 50`, `offset: 0`)

**Example Tool Definition (Zod):**
```typescript
const contactSearchInput = z.object({
  q: z.string().describe("Email, phone, or name substring"),
  limit: z.number().default(50).describe("Max results (1-100)"),
  offset: z.number().default(0),
  status: z.enum(["active", "inactive"]).optional()
});
```

---

## 5. Search Tool Design: Single vs. Many

**Single Flexible Tool (`crm.search`):**
- Pros: Agent uses 1 tool for 90% of lookups; fewer permission gates
- Cons: Relies on agent understanding filter syntax; harder to add specialized hints

**Many Narrow Tools (`contact_search`, `deal_search`, `company_search`):**
- Pros: Clearer intent; easier to add domain-specific optimizations
- Cons: More tools → higher context overhead; tool search must rank them

**Verdict (Supported by Block's Playbook):** Start with 3-5 focused tools per entity type:
- `contact_search(q, limit, status)` → read-only
- `contact_create(email, name, ...)` → write, requires idempotency key
- `deal_search(q, limit)` → read-only
- `deal_create(contact_id, title, ...)` → write

**Token Budget:** MCP Tool Search (Anthropic feature) defers loading tool definitions until agent searches; cuts tool-def tokens by 85%+.

---

## 6. Pagination & Token-Aware Responses

**Cursor-Based Pagination (preferred for agents):**
```json
{
  "data": [...],
  "next_cursor": "c_1234...",
  "has_more": true,
  "count": 100
}
```
- More stable than offset (no gaps during mutations)
- Agents call `search(..., cursor: prev_next_cursor)` for next page

**Limits & Truncation:**
- Default `limit=50`; max `limit=100` (agent budget)
- If response would exceed token budget, truncate and set `truncated: true`, return `next_cursor`
- Track remaining token budget in context; MCP servers should query context budget before expensive ops

**Rule:** Response JSON should fit in ~2K tokens for agent context efficiency.

---

## 7. CLI Command Examples

### Human CLI
```bash
crm contacts search --q "alice@example.com" --json
crm contacts create --name "Alice" --email alice@example.com --idempotency-key abc123
crm deals list --limit 10 --status "open" --json
```

### MCP Tools (same logic, typed)
```
tool: contact_search
input: { q: "alice@example.com", limit: 50 }
→ { data: [...], next_cursor: "c_...", count: 1 }
```

---

## 8. Auth Flow: CLI + MCP Server

**CLI (stdio transport):**
- Read from config file: `~/.crm/config.json` (encrypted or prompt for token on first use)
- Or env var: `CRM_API_KEY` (for CI/scripts)
- Support `crm config set --token <key>` to persist locally

**MCP Server (as separate process):**
- OAuth 2.1 preferred (enterprise standard, tenant isolation via `org_id` claim)
- Fallback: env var `CRM_MCP_TOKEN` (for local stdio MCP over stdio)
- Clients consume OAuth access token; MCP server validates & extracts tenant context
- Multi-org: Store `org_id` in token claims; queries are scoped to org automatically

**Security:**
- Never embed API keys in `mcp.json` config; use env or OS keychain
- Each MCP server process = one org (or embed org_id in token & scope all queries)

---

## 9. Error Handling for Agents

**Structured Error Response:**
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Email is invalid",
  "details": { "field": "email", "reason": "not_an_email" },
  "retryable": false,
  "retry_after_ms": null
}
```

**Agent-Friendly Codes:**
- `INVALID_INPUT` (400, non-retryable) → agent fixes params
- `NOT_FOUND` (404, non-retryable) → agent adjusts query
- `CONFLICT` (409, non-retryable if duplicate key) → idempotency dedupes; if true conflict, agent can update
- `RATE_LIMIT` (429, retryable, include `retry_after_ms`)
- `DB_ERROR` (500, retryable) → agent backs off

---

## 10. Architectural Fit for D1

**D1 Strengths:**
- Serverless, no connection pooling overhead
- REST API → CLI tool can call HTTP directly (e.g., Wrangler D1 REST API)
- Standard SQL → easy to share queries between CLI & MCP

**D1 Risks:**
- Cold starts on first query; cache warm query paths in MCP server if long-running
- Query size/complexity limits; keep MCP queries simple, break large ops into steps

**Recommended Stack:**
1. Core layer: D1 query builders (Drizzle ORM or raw SQL builders)
2. CLI: `commander` → calls core → formats output
3. MCP: TypeScript SDK → calls core → returns JSON
4. Both use same validation (Zod) & error codes

---

## Trade-Offs Summary

| Decision | Option A | Option B | Recommendation |
|----------|----------|----------|---|
| CLI Framework | `commander` (0 deps) | `yargs` (16 deps) | `commander` (lean, Git-style) |
| Tool Count | Single `search` | 5-10 focused tools | 5 focused (`contact_search`, `deal_search`, etc.) |
| Pagination | Offset | Cursor | Cursor (stable for agents) |
| Auth CLI | Env var | Config file | Config file + env var fallback |
| Auth MCP | OAuth 2.1 | API Key | OAuth 2.1 (multi-tenant safer) |
| Error Format | Plain text | Structured JSON | Structured JSON everywhere |

---

## Unresolved Questions

1. **D1 Row Limits:** What's the practical max row limit for a single query? If `contact_search` returns 100k results, should we enforce a hard limit (e.g., 500 rows max) for agent safety?
2. **Rate Limiting:** Should MCP tools implement per-org rate limits, or rely on Cloudflare Workers rate-limit policies?
3. **Caching:** For frequently accessed reference data (e.g., deal statuses), should MCP cache locally, or always hit D1?
4. **Observability:** Should MCP log tool calls to a separate audit table, or rely on D1/Cloudflare logs?

---

## Key Sources
- [Model Context Protocol Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Best Practices Architecture Guide](https://modelcontextprotocol.info/docs/best-practices/)
- [Writing CLI Tools That AI Agents Want to Use](https://dev.to/uenyioha/writing-cli-tools-that-ai-agents-actually-want-to-use-39no)
- [Agent-First CLIs: Reducing Turns](https://keyboardsdown.com/posts/01-agent-first-clis/)
- [CLI Spec 2025](https://clispec.dev/)
- [Agent Token Budget Management](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code)
- [Commander vs Yargs Comparison](https://npm-compare.com/commander,yargs)
- [Block's Playbook for MCP Server Design](https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers)
- [MCP Authentication: OAuth 2.1 & API Keys](https://toolradar.com/blog/mcp-authentication)
- [Idempotent AI Agents: Retry-Safe Patterns](https://www.buildmvpfast.com/blog/idempotent-ai-agent-retry-safe-patterns-production-workflow-2026)
- [TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)
