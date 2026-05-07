/**
 * MCP tools test suite.
 * - Asserts all expected tool names are registered.
 * - Asserts every tool has a non-empty description and object inputSchema.
 * - Exercises contact_create handler via in-memory SQLite (happy path + CONFLICT).
 * - Exercises contact_get NOT_FOUND error path.
 * - Asserts missing context returns AUTH_MISSING / ORG_NOT_FOUND.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { makeTestDb } from '../core/crm/internal/sqlite-test-adapter.js';
import {
  registerAllTools,
  getToolDefinitions,
  invokeToolHandler,
  TOOL_NAMES,
} from './tools/index.js';
import type { McpContext } from './context.js';
import type { D1Client } from '../core/d1-client.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeServer(client: D1Client): { server: McpServer; ctx: McpContext } {
  const ctx: McpContext = {
    client,
    baseClient: client,
    slug: 'test-org',
    dbId: 'test-db-id',
  };
  const server = new McpServer({ name: 'crmd1-test', version: '0.0.0' });
  registerAllTools(server, () => ctx);
  return { server, ctx };
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function call(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return invokeToolHandler(server, name, args);
}

function parseBody<T>(result: ToolResult): T {
  const text = result.content[0]?.text ?? '{}';
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Registration tests
// ---------------------------------------------------------------------------

describe('MCP tool registration', () => {
  let server: McpServer;

  beforeEach(() => {
    const { client } = makeTestDb();
    ({ server } = makeServer(client));
  });

  it('registers all expected tool names', () => {
    const defs = getToolDefinitions(server);
    const registeredNames = new Set(defs.map((d) => d.name));
    for (const name of TOOL_NAMES) {
      expect(registeredNames.has(name), `Missing tool: ${name}`).toBe(true);
    }
  });

  it('every tool has a non-empty description', () => {
    const defs = getToolDefinitions(server);
    for (const def of defs) {
      expect(def.description.length, `Empty description for: ${def.name}`).toBeGreaterThan(0);
    }
  });

  it('every tool has inputSchema with type: object', () => {
    const defs = getToolDefinitions(server);
    for (const def of defs) {
      expect(def.inputSchema.type, `Bad inputSchema.type for: ${def.name}`).toBe('object');
    }
  });

  it(`registers exactly ${TOOL_NAMES.length} tools`, () => {
    const defs = getToolDefinitions(server);
    expect(defs.length).toBe(TOOL_NAMES.length);
  });
});

// ---------------------------------------------------------------------------
// contact_create — happy path
// ---------------------------------------------------------------------------

describe('contact_create handler', () => {
  let server: McpServer;

  beforeEach(() => {
    const { client } = makeTestDb();
    ({ server } = makeServer(client));
  });

  it('creates a contact and returns ok:true with the new record', async () => {
    const result = await call(server, 'contact_create', {
      email: 'alice@example.com',
      first_name: 'Alice',
      last_name: 'Smith',
      idempotency_key: 'test-idem-1',
    });

    expect(result.isError).toBeFalsy();
    const body = parseBody<{ ok: boolean; data: { email: string; first_name: string } }>(result);
    expect(body.ok).toBe(true);
    expect(body.data.email).toBe('alice@example.com');
    expect(body.data.first_name).toBe('Alice');
  });

  it('returns isError on duplicate email (CONFLICT)', async () => {
    await call(server, 'contact_create', {
      email: 'bob@example.com',
      first_name: 'Bob',
      last_name: 'Jones',
    });

    const result = await call(server, 'contact_create', {
      email: 'bob@example.com',
      first_name: 'Bob',
      last_name: 'Jones',
    });

    expect(result.isError).toBe(true);
    // CrmdError.toJSON shape: { ok: false, error: { code } }
    const body = parseBody<{ ok: false; error: { code: string } }>(result);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// contact_get — NOT_FOUND error path
// ---------------------------------------------------------------------------

describe('contact_get handler', () => {
  let server: McpServer;

  beforeEach(() => {
    const { client } = makeTestDb();
    ({ server } = makeServer(client));
  });

  it('returns isError with NOT_FOUND for unknown UUID', async () => {
    const result = await call(server, 'contact_get', {
      id: '00000000-0000-0000-0000-000000000001',
    });

    expect(result.isError).toBe(true);
    const body = parseBody<{ ok: false; error: { code: string } }>(result);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// missing context — AUTH_MISSING / ORG_NOT_FOUND
// ---------------------------------------------------------------------------

describe('missing context handling', () => {
  it('returns isError when context is null (no auth/org)', async () => {
    const server = new McpServer({ name: 'crmd1-noauth', version: '0.0.0' });
    registerAllTools(server, () => null);

    const result = await call(server, 'contact_create', {
      email: 'x@x.com',
      first_name: 'X',
      last_name: 'Y',
    });

    expect(result.isError).toBe(true);
    const body = parseBody<{ ok: false; error: { code: string } }>(result);
    expect(['AUTH_MISSING', 'ORG_NOT_FOUND']).toContain(body.error.code);
  });
});
