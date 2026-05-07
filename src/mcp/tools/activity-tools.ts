/**
 * MCP tool registrations for CRM activities.
 * Activities are append-only (no update). Soft-delete supported.
 * Tools: activity_log, activity_get, activity_list, activity_delete.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../context.js';
import { missingContextResult } from '../context.js';
import {
  activityCreate,
  activityGet,
  activityList,
  activitySoftDelete,
} from '../../core/crm/index.js';
import { serializeError, CrmdError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
}

function fail(err: unknown): ToolResult {
  logger.debug('activity tool error', { err: String(err) });
  if (err instanceof CrmdError) {
    return { content: [{ type: 'text', text: JSON.stringify(err.toJSON()) }], isError: true };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: serializeError(err) }) }],
    isError: true,
  };
}

export function registerActivityTools(server: McpServer, getCtx: () => McpContext | null): void {
  server.tool(
    'activity_log',
    'Log an activity (call, email, meeting, note, demo, etc.) against a contact, company, or deal. Activities are immutable once created — use idempotency_key for safe retries. Example: activity_log({ entity_type: "contact", entity_id: "...", activity_type: "call", summary: "Discussed renewal terms.", idempotency_key: "wf-9-act-1" }).',
    {
      entity_type: z.enum(['contact', 'company', 'deal']).describe('Type of entity this activity belongs to.'),
      entity_id: z.string().min(1).describe('UUID of the entity (contact, company, or deal).'),
      activity_type: z.enum(['call', 'email', 'meeting', 'note', 'task_completed', 'demo', 'follow_up', 'other']).describe('Activity type.'),
      summary: z.string().min(1).max(5000).describe('Human-readable summary of what happened.'),
      next_follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Scheduled follow-up date (YYYY-MM-DD).'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Optional structured metadata (e.g. call duration, email subject).'),
      idempotency_key: z.string().min(1).max(128).optional().describe('Unique key for safe retries (24h dedup window).'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { idempotency_key, ...rest } = input;
      try {
        return ok(await activityCreate(ctx.client, rest, { idempotency_key }));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'activity_get',
    'Fetch a single activity by UUID. Returns NOT_FOUND if soft-deleted or missing.',
    { id: z.string().uuid().describe('Activity UUID.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await activityGet(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'activity_list',
    'List activities with optional filters. Cursor-based pagination via next_cursor. Example: activity_list({ entity_type: "contact", entity_id: "...", activity_type: "call", limit: 20 }).',
    {
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max results. Default 50.'),
      cursor: z.string().optional().describe('Pagination cursor from a prior activity_list response.'),
      entity_type: z.enum(['contact', 'company', 'deal']).optional().describe('Filter by entity type.'),
      entity_id: z.string().optional().describe('Filter by entity UUID.'),
      activity_type: z.enum(['call', 'email', 'meeting', 'note', 'task_completed', 'demo', 'follow_up', 'other']).optional().describe('Filter by activity type.'),
      include_deleted: z.boolean().optional().default(false).describe('Include soft-deleted activities.'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await activityList(ctx.client, input));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'activity_delete',
    'Soft-delete an activity by UUID. The record is retained with deleted_at set. Activities cannot be restored (append-only semantics).',
    { id: z.string().uuid().describe('Activity UUID to soft-delete.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await activitySoftDelete(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );
}
