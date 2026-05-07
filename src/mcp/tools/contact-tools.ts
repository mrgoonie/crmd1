/**
 * MCP tool registrations for CRM contacts.
 * Tools: contact_create, contact_get, contact_list, contact_update, contact_delete, contact_restore.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../context.js';
import { missingContextResult } from '../context.js';
import {
  contactCreate,
  contactGet,
  contactList,
  contactUpdate,
  contactSoftDelete,
  contactRestore,
} from '../../core/crm/index.js';
import { serializeError, CrmdError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
}

function fail(err: unknown): ToolResult {
  logger.debug('contact tool error', { err: String(err) });
  if (err instanceof CrmdError) {
    return { content: [{ type: 'text', text: JSON.stringify(err.toJSON()) }], isError: true };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: serializeError(err) }) }],
    isError: true,
  };
}

export function registerContactTools(server: McpServer, getCtx: () => McpContext | null): void {
  server.tool(
    'contact_create',
    'Create a new CRM contact. Email must be unique. Provide idempotency_key to safely retry on network failure — duplicate calls with the same key return the original record. Example: contact_create({ email: "alice@example.com", first_name: "Alice", last_name: "Smith", idempotency_key: "wf-123-step-1" }).',
    {
      email: z.string().email().describe('Contact email address (unique).'),
      first_name: z.string().min(1).max(255).describe('First name.'),
      last_name: z.string().min(1).max(255).describe('Last name.'),
      phone: z.string().max(50).optional().describe('Phone number.'),
      job_title: z.string().max(255).optional().describe('Job title.'),
      company_id: z.string().uuid().optional().describe('UUID of linked company.'),
      status: z.enum(['prospect', 'active', 'inactive', 'churned']).optional().describe('Contact status. Default: prospect.'),
      notes_summary: z.string().max(5000).optional().describe('Free-text notes.'),
      idempotency_key: z.string().min(1).max(128).optional().describe('Unique key for safe retries (24h dedup window).'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { idempotency_key, ...rest } = input;
      try {
        const result = await contactCreate(ctx.client, rest, { idempotency_key });
        return ok(result);
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'contact_get',
    'Fetch a single contact by UUID. Returns NOT_FOUND if the contact is deleted or missing. Use contact_list with include_deleted: true to find soft-deleted records.',
    { id: z.string().uuid().describe('Contact UUID.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await contactGet(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'contact_list',
    'List contacts with optional filters. Supports cursor-based pagination — pass next_cursor from the previous response. Example: contact_list({ status: "active", limit: 20 }) or contact_list({ q: "alice", cursor: "c_..." }).',
    {
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max results (1-100). Default 50.'),
      cursor: z.string().optional().describe('Pagination cursor from a prior contact_list response.'),
      company_id: z.string().optional().describe('Filter by company UUID.'),
      email: z.string().optional().describe('Exact email match.'),
      status: z.enum(['prospect', 'active', 'inactive', 'churned']).optional().describe('Filter by status.'),
      q: z.string().optional().describe('Substring search across name and email.'),
      include_deleted: z.boolean().optional().default(false).describe('Include soft-deleted contacts.'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await contactList(ctx.client, input));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'contact_update',
    'Partially update a contact by UUID. Only provided fields are changed. Example: contact_update({ id: "...", status: "active", job_title: "CEO" }).',
    {
      id: z.string().uuid().describe('Contact UUID.'),
      email: z.string().email().optional(),
      first_name: z.string().min(1).max(255).optional(),
      last_name: z.string().min(1).max(255).optional(),
      phone: z.string().max(50).optional(),
      job_title: z.string().max(255).optional(),
      company_id: z.string().uuid().optional(),
      status: z.enum(['prospect', 'active', 'inactive', 'churned']).optional(),
      notes_summary: z.string().max(5000).optional(),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { id, ...patch } = input;
      try {
        return ok(await contactUpdate(ctx.client, id, patch));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'contact_delete',
    'Soft-delete a contact by UUID. The record is retained in the database with deleted_at set; use contact_restore to undo. Returns NOT_FOUND if already deleted.',
    { id: z.string().uuid().describe('Contact UUID to soft-delete.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await contactSoftDelete(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'contact_restore',
    'Restore a previously soft-deleted contact, clearing its deleted_at timestamp.',
    { id: z.string().uuid().describe('Contact UUID to restore.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await contactRestore(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );
}
