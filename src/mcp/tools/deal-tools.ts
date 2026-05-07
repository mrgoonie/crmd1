/**
 * MCP tool registrations for CRM deals.
 * Tools: deal_create, deal_get, deal_list, deal_update, deal_delete, deal_restore.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../context.js';
import { missingContextResult } from '../context.js';
import {
  dealCreate,
  dealGet,
  dealList,
  dealUpdate,
  dealSoftDelete,
  dealRestore,
} from '../../core/crm/index.js';
import { serializeError, CrmdError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
}

function fail(err: unknown): ToolResult {
  logger.debug('deal tool error', { err: String(err) });
  if (err instanceof CrmdError) {
    return { content: [{ type: 'text', text: JSON.stringify(err.toJSON()) }], isError: true };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: serializeError(err) }) }],
    isError: true,
  };
}

export function registerDealTools(server: McpServer, getCtx: () => McpContext | null): void {
  server.tool(
    'deal_create',
    'Create a new CRM deal linked to a company. Use idempotency_key for safe retries. Example: deal_create({ title: "Acme Q3 Renewal", company_id: "...", stage: "proposal", amount: 50000, idempotency_key: "wf-7-deal-1" }).',
    {
      title: z.string().min(1).max(255).describe('Deal title.'),
      company_id: z.string().uuid().describe('UUID of the owning company (required).'),
      amount: z.number().min(0).optional().describe('Deal value in the account currency.'),
      stage: z.enum(['prospect', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost']).optional().describe('Pipeline stage.'),
      close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Expected close date (YYYY-MM-DD).'),
      probability: z.number().int().min(0).max(100).optional().describe('Win probability 0-100.'),
      owner_user_id: z.string().optional().describe('User ID of deal owner.'),
      linked_contacts: z.array(z.string().uuid()).optional().describe('UUIDs of associated contacts.'),
      notes_summary: z.string().max(5000).optional().describe('Free-text notes.'),
      idempotency_key: z.string().min(1).max(128).optional().describe('Unique key for safe retries (24h dedup window).'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { idempotency_key, ...rest } = input;
      try {
        return ok(await dealCreate(ctx.client, rest, { idempotency_key }));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'deal_get',
    'Fetch a single deal by UUID. Returns NOT_FOUND if soft-deleted or missing.',
    { id: z.string().uuid().describe('Deal UUID.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await dealGet(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'deal_list',
    'List deals with optional filters. Cursor-based pagination via next_cursor. Example: deal_list({ stage: "proposal", min_amount: 10000, limit: 20 }).',
    {
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max results. Default 50.'),
      cursor: z.string().optional().describe('Pagination cursor from a prior deal_list response.'),
      stage: z.enum(['prospect', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost']).optional().describe('Filter by pipeline stage.'),
      company_id: z.string().optional().describe('Filter by company UUID.'),
      contact_id: z.string().optional().describe('Filter deals linked to this contact UUID.'),
      min_amount: z.number().optional().describe('Minimum deal amount.'),
      max_amount: z.number().optional().describe('Maximum deal amount.'),
      include_deleted: z.boolean().optional().default(false).describe('Include soft-deleted deals.'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await dealList(ctx.client, input));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'deal_update',
    'Partially update a deal by UUID. Only provided fields are changed. Example: deal_update({ id: "...", stage: "closed_won", probability: 100 }).',
    {
      id: z.string().uuid().describe('Deal UUID.'),
      title: z.string().min(1).max(255).optional(),
      company_id: z.string().uuid().optional(),
      amount: z.number().min(0).optional(),
      stage: z.enum(['prospect', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost']).optional(),
      close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      probability: z.number().int().min(0).max(100).optional(),
      owner_user_id: z.string().optional(),
      linked_contacts: z.array(z.string().uuid()).optional(),
      notes_summary: z.string().max(5000).optional(),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { id, ...patch } = input;
      try {
        return ok(await dealUpdate(ctx.client, id, patch));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'deal_delete',
    'Soft-delete a deal by UUID. Record is retained with deleted_at set. Use deal_restore to undo.',
    { id: z.string().uuid().describe('Deal UUID to soft-delete.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await dealSoftDelete(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'deal_restore',
    'Restore a previously soft-deleted deal, clearing its deleted_at timestamp.',
    { id: z.string().uuid().describe('Deal UUID to restore.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await dealRestore(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );
}
