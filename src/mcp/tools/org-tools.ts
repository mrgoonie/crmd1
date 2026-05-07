/**
 * MCP tool registrations for org management and global CRM search.
 * Tools: org_create, org_list, org_use, org_current, org_delete, db_init, db_query, crm_search.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../context.js';
import { missingContextResult } from '../context.js';
import { createOrg, listOrgs, useOrg, deleteOrg } from '../../core/org.js';
import { initDatabase } from '../../core/db-init.js';
import { crmSearch } from '../../core/crm/index.js';
import { CrmdError } from '../../core/errors.js';
import { serializeError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
}

function fail(err: unknown): ToolResult {
  logger.debug('MCP tool error', { err: String(err) });
  const serialized = serializeError(err);
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: serialized }) }],
    isError: true,
  };
}

export function registerOrgTools(server: McpServer, getCtx: () => McpContext | null): void {
  server.tool(
    'org_create',
    'Create a new CRM organization backed by a Cloudflare D1 database. Example: org_create({ slug: "acme", init_schema: true }).',
    { slug: z.string().describe('Lowercase alphanumeric + hyphens org identifier (e.g. "acme").'),
      init_schema: z.boolean().optional().default(true).describe('Apply DB schema after creation. Default true.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('auth');
      try {
        const result = await createOrg(ctx.baseClient, input.slug, {
          applySchema: input.init_schema ? (c) => initDatabase(c).then(() => undefined) : undefined,
        });
        return ok(result);
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'org_list',
    'List all configured CRM organizations. Returns slug, database_id, and whether each is the active org.',
    {},
    async () => {
      try {
        const orgs = await listOrgs();
        return ok(orgs);
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'org_use',
    'Set the active organization for subsequent tool calls. Example: org_use({ slug: "acme" }). Only affects config-based default; env CRMD1_ORG always overrides.',
    { slug: z.string().describe('Org slug to activate.') },
    async (input) => {
      try {
        await useOrg(input.slug);
        return ok({ slug: input.slug, active: true });
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'org_current',
    'Return the currently active org slug and database ID. Useful before running CRM operations to confirm context.',
    {},
    async () => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      return ok({ slug: ctx.slug, database_id: ctx.dbId });
    },
  );

  server.tool(
    'org_delete',
    'Remove an org from local config. Pass drop_database: true to also delete the Cloudflare D1 database (IRREVERSIBLE). Example: org_delete({ slug: "acme", drop_database: false }).',
    { slug: z.string().describe('Org slug to delete.'),
      drop_database: z.boolean().optional().default(false).describe('Also delete the D1 database. Irreversible.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('auth');
      try {
        await deleteOrg(ctx.baseClient, input.slug, { dropDatabase: input.drop_database });
        return ok({ slug: input.slug, deleted: true });
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'db_init',
    'Apply the CRM schema (DDL + FTS5 triggers) to the active org database. Idempotent — safe to re-run. Call this after org_create if init_schema was false.',
    {},
    async () => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        await initDatabase(ctx.client);
        return ok({ initialized: true });
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'db_query',
    'ESCAPE HATCH: Execute raw SQL against the active org D1 database. Use only when no specific tool meets your need. Parameters must be bound values (not string-concatenated). Example: db_query({ sql: "SELECT COUNT(*) FROM contacts", params: [] }).',
    { sql: z.string().min(1).max(10000).describe('Parameterized SQL statement.'),
      params: z.array(z.unknown()).optional().default([]).describe('Bound parameter values.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        const result = await ctx.client.query(input.sql, input.params as unknown[]);
        return ok(result);
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'crm_search',
    'Full-text search across contacts, companies, deals, activities, and tasks using FTS5. Pass q as a phrase or use FTS5 operators (AND/OR/NOT). Returns entity_type + entity_id + snippet. Example: crm_search({ q: "alice@example.com" }). Paginate with cursor from next_cursor.',
    { q: z.string().min(1).max(500).describe('Search phrase or FTS5 query (e.g. "alice" or "alice AND deal").'),
      types: z.array(z.enum(['contact', 'company', 'deal', 'activity', 'task'])).optional().describe('Limit to these entity types. Omit to search all.'),
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max results (1-100). Default 50.'),
      cursor: z.string().optional().describe('Pagination cursor from a previous crm_search response.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        const result = await crmSearch(ctx.client, {
          q: input.q,
          types: input.types as Array<'contact' | 'company' | 'deal' | 'activity' | 'task'> | undefined,
          limit: input.limit,
          cursor: input.cursor,
        });
        return ok(result);
      } catch (e) {
        if (e instanceof CrmdError) {
          return { content: [{ type: 'text', text: JSON.stringify(e.toJSON()) }], isError: true };
        }
        return fail(e);
      }
    },
  );
}
