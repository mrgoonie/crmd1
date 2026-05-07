/**
 * MCP tool registrations for CRM tasks.
 * Tools: task_create, task_get, task_list, task_update, task_complete, task_delete, task_restore.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../context.js';
import { missingContextResult } from '../context.js';
import {
  taskCreate,
  taskGet,
  taskList,
  taskUpdate,
  taskComplete,
  taskSoftDelete,
  taskRestore,
} from '../../core/crm/index.js';
import { serializeError, CrmdError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }] };
}

function fail(err: unknown): ToolResult {
  logger.debug('task tool error', { err: String(err) });
  if (err instanceof CrmdError) {
    return { content: [{ type: 'text', text: JSON.stringify(err.toJSON()) }], isError: true };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: serializeError(err) }) }],
    isError: true,
  };
}

export function registerTaskTools(server: McpServer, getCtx: () => McpContext | null): void {
  server.tool(
    'task_create',
    'Create a new task, optionally linked to a contact, company, or deal. Use idempotency_key for safe retries. Example: task_create({ title: "Send proposal", due_date: "2025-06-01", entity_type: "deal", entity_id: "...", priority: "high", idempotency_key: "wf-5-task-1" }).',
    {
      title: z.string().min(1).max(255).describe('Task title.'),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Due date (YYYY-MM-DD).'),
      description: z.string().max(5000).optional().describe('Detailed description.'),
      entity_type: z.enum(['contact', 'company', 'deal']).optional().describe('Type of linked entity.'),
      entity_id: z.string().optional().describe('UUID of linked entity (requires entity_type).'),
      assigned_to: z.string().optional().describe('User ID or name of assignee.'),
      status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('Task status. Default: open.'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().describe('Task priority.'),
      idempotency_key: z.string().min(1).max(128).optional().describe('Unique key for safe retries (24h dedup window).'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { idempotency_key, ...rest } = input;
      try {
        return ok(await taskCreate(ctx.client, rest, { idempotency_key }));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'task_get',
    'Fetch a single task by UUID. Returns NOT_FOUND if soft-deleted or missing.',
    { id: z.string().uuid().describe('Task UUID.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await taskGet(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'task_list',
    'List tasks with optional filters. Cursor-based pagination via next_cursor. Example: task_list({ status: "open", priority: "high", due_before: "2025-06-30" }).',
    {
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Max results. Default 50.'),
      cursor: z.string().optional().describe('Pagination cursor from a prior task_list response.'),
      status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional().describe('Filter by status.'),
      assignee: z.string().optional().describe('Filter by assignee user ID or name.'),
      entity_type: z.enum(['contact', 'company', 'deal']).optional().describe('Filter by linked entity type.'),
      entity_id: z.string().optional().describe('Filter by linked entity UUID.'),
      due_before: z.string().optional().describe('Include only tasks due before this date (YYYY-MM-DD).'),
      due_after: z.string().optional().describe('Include only tasks due after this date (YYYY-MM-DD).'),
      include_deleted: z.boolean().optional().default(false).describe('Include soft-deleted tasks.'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await taskList(ctx.client, input));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'task_update',
    'Partially update a task by UUID. Only provided fields are changed. Example: task_update({ id: "...", status: "in_progress", priority: "urgent" }).',
    {
      id: z.string().uuid().describe('Task UUID.'),
      title: z.string().min(1).max(255).optional(),
      due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      description: z.string().max(5000).optional(),
      entity_type: z.enum(['contact', 'company', 'deal']).optional(),
      entity_id: z.string().optional(),
      assigned_to: z.string().optional(),
      status: z.enum(['open', 'in_progress', 'completed', 'cancelled']).optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      const { id, ...patch } = input;
      try {
        return ok(await taskUpdate(ctx.client, id, patch));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'task_complete',
    'Mark a task as completed. Shorthand for task_update with status: "completed". Example: task_complete({ id: "..." }).',
    {
      id: z.string().uuid().describe('Task UUID to mark as completed.'),
      updated_by: z.string().optional().describe('User ID or name of who completed the task.'),
    },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await taskComplete(ctx.client, input.id, input.updated_by));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'task_delete',
    'Soft-delete a task by UUID. Record is retained with deleted_at set. Use task_restore to undo.',
    { id: z.string().uuid().describe('Task UUID to soft-delete.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await taskSoftDelete(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    'task_restore',
    'Restore a previously soft-deleted task, clearing its deleted_at timestamp.',
    { id: z.string().uuid().describe('Task UUID to restore.') },
    async (input) => {
      const ctx = getCtx();
      if (!ctx) return missingContextResult('org');
      try {
        return ok(await taskRestore(ctx.client, input.id));
      } catch (e) { return fail(e); }
    },
  );
}
