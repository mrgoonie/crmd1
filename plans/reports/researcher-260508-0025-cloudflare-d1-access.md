# Cloudflare D1 Node.js CLI Access Research

## 1. REST API for D1 (Production Access)

### Endpoints

| Operation | Endpoint | Method |
|-----------|----------|--------|
| List databases | `/accounts/{account_id}/d1/database` | GET |
| Create database | `/accounts/{account_id}/d1/database` | POST |
| Execute query | `/accounts/{account_id}/d1/database/{db_id}/query` | POST |
| Execute raw (arrays) | `/accounts/{account_id}/d1/database/{db_id}/raw` | POST |
| Batch queries | `/accounts/{account_id}/d1/database/{db_id}/batch` | POST |
| Export SQL | `/accounts/{account_id}/d1/database/{db_id}/export` | POST |
| Import SQL | `/accounts/{account_id}/d1/database/{db_id}/import` | POST |

### Authentication
- Bearer token: `Authorization: Bearer {CLOUDFLARE_API_TOKEN}`
- Account ID: Found in Cloudflare dashboard under Account Details
- Tokens use `cfut_` (user) or `cfat_` (account) prefix (scannable format)

### Rate Limits & Constraints
- **No explicit rate limit**, throughput depends on query duration (1ms avg = ~1,000 qps)
- **Query timeout**: 30 seconds max
- **Statement size**: 100 KB max per statement
- **Bound parameters**: 100 max per query
- **Batch queries per invocation**: 1,000 (Paid) / 50 (Free tier)
- **File imports**: 5 GB max via `d1 execute`
- **Simultaneous connections**: 6 per Worker invocation
- D1 single-threaded: processes queries sequentially, optimize queries aggressively

## 2. Integration Approaches: Wrangler vs Raw HTTP

### Option A: Wrangler as Library (Recommended for local dev, NOT production)
```javascript
// For LOCAL DEVELOPMENT ONLY via getPlatformProxy
import { getPlatformProxy } from 'wrangler';

const { env } = await getPlatformProxy();
const db = env.DB; // Requires wrangler.toml D1 binding
const result = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).all();
```

**Pros:**
- Emulates production bindings locally
- No credential management needed for local dev
- Reads from `wrangler.toml`

**Cons:**
- `getPlatformProxy` is LOCAL-ONLY, cannot access remote production DB
- Requires `wrangler.toml` with D1 binding defined
- Best-effort emulation, not exact production behavior
- Cannot be used in CI/CD for remote DB access

### Option B: REST API via HTTP Client (Production Ready)
```javascript
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_TOKEN}` },
    body: JSON.stringify({
      sql: 'SELECT * FROM users WHERE id = ?',
      params: [id]
    })
  }
);
const { result } = await response.json();
```

**Pros:**
- Works from any Node.js context (CLI, server, etc.)
- No Wrangler dependency
- Production-ready for remote DB access

**Cons:**
- Manual credential management required
- Must handle HTTP errors, retries, rate limiting

## 3. Official SDK & Community Packages

### Official: `@cloudflare/d1`
```bash
npm install @cloudflare/d1
```
- Installed automatically via `wrangler d1 create`
- Implements D1 API + Database class
- Supports static + prepared statements
- **Use case**: Worker bindings only, NOT CLI access

### Community: `@nathanbeddoewebdev/d1-sdk`
```bash
npm install @nathanbeddoewebdev/d1-sdk
```
- TypeScript/JS client for HTTP API
- Methods: `createDB()`, `listDBs()`, `executeSQL()`
- Example:
```javascript
import D1SDK from '@nathanbeddoewebdev/d1-sdk';
const d1 = new D1SDK({ apiToken: TOKEN, accountId: ACCOUNT_ID });
const dbs = await d1.listDBs();
const result = await d1.executeSQL(dbId, 'SELECT * FROM users');
```

### Community: `cloudflare-d1-http-knex`
- Wraps REST API with Knex.js query builder
- Useful if your codebase already uses Knex

### **Recommendation**: No official SDK for REST API yet. Use `@nathanbeddoewebdev/d1-sdk` OR build thin HTTP wrapper for minimal deps.

## 4. Multi-Tenant Pattern (Org = DB)

### Naming Convention
- Slugify org names: `"Acme Corp"` → `acme-corp` or `acme_corp`
- Database names: `{slug}-db` or `{slug}_{env}`
- Example: `acme-corp-prod`, `acme-corp-dev`

### Creation Flow
```javascript
async function createOrgDatabase(orgName) {
  const slug = orgName.toLowerCase().replace(/\s+/g, '-');
  const dbName = `${slug}-db`;
  
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_TOKEN}` },
      body: JSON.stringify({ name: dbName })
    }
  );
  const { result } = await response.json();
  return result.id; // Store this mapping
}
```

### Credential Storage Per-Org
- Do NOT create separate API tokens per org (complex management)
- Single API token with `Account.D1` permission
- Store org→DB ID mapping in `~/.config/<cli>/orgs.json`:
```json
{
  "acme-corp": { "db_id": "abc123", "created": "2026-05-08" },
  "rival-inc": { "db_id": "def456", "created": "2026-05-09" }
}
```

## 5. Credential Storage (CLI Best Practices)

### Location & Format
```bash
~/.config/<tool>/config.json  # Main credentials file
~/.config/<tool>/orgs.json    # Org→DB mappings
```

### Config Structure (Encrypted Recommended)
```json
{
  "cloudflare": {
    "api_token": "cfut_...",
    "account_id": "abc123xyz",
    "encrypted": true
  }
}
```

### Auth Precedence (Cloudflare convention)
1. `CLOUDFLARE_API_TOKEN` env var (for CI/CD)
2. `~/.config/<tool>/config.json` (local CLI)
3. Interactive login via OAuth (fallback)

### Encryption for Local Storage
- **Do NOT store tokens plaintext** in files
- Use `secure-conf` or file-based GPG encryption
- Or: OS keychain integration (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Example (secure-conf npm package):
```javascript
import secure from 'secure-conf';
const config = new secure.SecureConf();
await config.read(); // Decrypts ~/.config/<tool>/config.json
const token = config.get('cloudflare.api_token');
```

## 6. SQLite Dialect Notes

### D1 = SQLite
- No vendor lock-in on SQL dialect
- Supports SQLite 3 syntax
- Limitations: No stored procedures, triggers are limited

### Query Patterns for CLI
```javascript
// Prepared statement (safe, optimized)
await db.prepare('INSERT INTO users (name, email) VALUES (?, ?)').bind(name, email).run();

// Batch (multiple statements, atomic)
await db.batch([
  db.prepare('INSERT INTO logs (msg) VALUES (?)').bind('Action 1'),
  db.prepare('INSERT INTO logs (msg) VALUES (?)').bind('Action 2')
]);

// Raw SQL (debug only, avoid in CLI)
await db.exec('SELECT * FROM users;');
```

### CLI-Specific Considerations
- Break large migrations into batches (1,000 rows at a time max)
- Timeout queries > 30s into smaller chunks
- Use `.raw` endpoint for array results (faster serialization)
- Prepare statements to prevent SQL injection from user input

## Code Snippet: Minimal HTTP Wrapper

```javascript
// src/d1-client.ts
import fetch from 'node-fetch';

export class D1Client {
  constructor(private apiToken: string, private accountId: string) {}

  async listDatabases() {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database`,
      { headers: { Authorization: `Bearer ${this.apiToken}` } }
    );
    const { result } = await res.json();
    return result;
  }

  async query(dbId: string, sql: string, params?: unknown[]) {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${dbId}/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params })
      }
    );
    const { result } = await res.json();
    return result[0]; // Returns { success: bool, meta: {...}, results: [...] }
  }
}
```

## Trade-Off Summary

| Dimension | Wrangler + getPlatformProxy | REST API + HTTP | Community SDK |
|-----------|----------------------------|-----------------|---------------|
| Production access | ❌ Local only | ✅ Full remote | ✅ Full remote |
| Credentials needed | No | Yes (env/file) | Yes (env/file) |
| Learning curve | Medium | Low | Low |
| Maintenance | Cloudflare-owned | DIY | Community |
| Multi-tenant | ⚠ Requires worktree per org | ✅ Single client, switch DB ID | ✅ Single client |
| Embedding in CLI | ⚠ Not intended | ✅ Ideal | ✅ Ideal |

## Recommendation

**For a production Node.js CLI accessing remote D1:**
1. Use REST API + simple HTTP fetch OR `@nathanbeddoewebdev/d1-sdk`
2. Store credentials in `~/.config/<tool>/config.json` (encrypted via `secure-conf` or GPG)
3. Support `CLOUDFLARE_API_TOKEN` env var for CI/CD
4. Implement org→DB mapping in `~/.config/<tool>/orgs.json`
5. Use prepared statements, handle 30s timeout, batch large migrations

**Adoption Risk**: Low. REST API is stable. Community SDK is maintained but smaller audience—consider vendoring if desired.

---

## Unresolved Questions

1. Does Cloudflare provide OS keychain integration for CLI credential storage, or is file-based encryption the standard?
2. What is the actual throughput ceiling for the REST API (is it the same 30s timeout as Workers)?
3. Are there official per-org API token scoping options (vs. single account token)?
