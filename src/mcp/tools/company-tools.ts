/**
 * MCP tool registrations for CRM companies.
 * Tools: company_create, company_get, company_list, company_update, company_delete, company_restore.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../context.js';
import { missingContextResult } from '../context.js';
import {
  companyCreate,
  companyGet,
  companyList,
  companyUpdate,
  companySoftDelete,
  companyRestore,
} from '../../core/crm/index.js';
import { serializeError, CrmdError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
}

function fail(err: unknown): ToolResult {
  logger.debug('company tool error', { err: String(err) });
  if (err instanceof CrmdError) {
    return { content: [{ type: 'text', text: JSON.stringify(err.toJSON()) }], isError: true };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: serializeError(err) }) }],
    isError: true,
  };
}

export function registerCompanyTools(server: McpServer, getCtx: () => McpContext | null): void {
  server.tool(
    'company_create',
    'Create a new CRM company. Domain must be unique when provided. Use idempotency_key for safe retries. Example: company_create({ name: "Acme Corp", domain: "acme.com", idempotency_key: "wf-42-co-1" }).',
    {
      name: z.string().min(1).max(255).describe('Company name.'),
      domain: z.string().optional().describe('Primary domain (e.g. acme.com). Must be unique.'),
      industry: z.string().max(255).optional().describe('Industry (e.g. "SaaS", "Finance").'),
      employee_count: z.number().int().min(0).optional().describe('Approximate headcount.'),
      status: z.enum(['active', 'inactive', 'prospect', 'churned']).optional().describe('Company status. Default: active.'),
      notes_summary: z.string().max(5000).optional().describe('Free-text notes.'),
      idempotency_key: z.string().min(1).max(128).optional().describe('Unique key for safe retries (24h dedup window).'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { idempotency_key, ...rest } = input;
      try {
        return ok(await companyCreate(ctx.client, rest, { idempotency_key }));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'company_get',
    'Fetch a single company by UUID. Returns NOT_FOUND if soft-deleted or missing. Use company_list with include_deleted: true to find deleted records.',
    { id: z.string().uuid().describe('Company UUID.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await companyGet(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'company_list',
    'List companies with optional filters. Cursor-based pagination: pass next_cursor from a prior response. Example: company_list({ status: "active", q: "acme", limit: 25 }).',
    {
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max results. Default 50.'),
      cursor: z.string().optional().describe('Pagination cursor from a prior company_list response.'),
      domain: z.string().optional().describe('Exact domain match.'),
      status: z.enum(['active', 'inactive', 'prospect', 'churned']).optional().describe('Filter by status.'),
      q: z.string().optional().describe('Substring search across name, domain, and industry.'),
      include_deleted: z.boolean().optional().default(false).describe('Include soft-deleted companies.'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await companyList(ctx.client, input));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'company_update',
    'Partially update a company by UUID. Only provided fields are changed. Example: company_update({ id: "...", employee_count: 250, status: "active" }).',
    {
      id: z.string().uuid().describe('Company UUID.'),
      name: z.string().min(1).max(255).optional(),
      domain: z.string().optional(),
      industry: z.string().max(255).optional(),
      employee_count: z.number().int().min(0).optional(),
      status: z.enum(['active', 'inactive', 'prospect', 'churned']).optional(),
      notes_summary: z.string().max(5000).optional(),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { id, ...patch } = input;
      try {
        return ok(await companyUpdate(ctx.client, id, patch));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'company_delete',
    'Soft-delete a company by UUID. Record is retained with deleted_at set. Use company_restore to undo.',
    { id: z.string().uuid().describe('Company UUID to soft-delete.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await companySoftDelete(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'company_restore',
    'Restore a previously soft-deleted company, clearing its deleted_at timestamp.',
    { id: z.string().uuid().describe('Company UUID to restore.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await companyRestore(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );
}
