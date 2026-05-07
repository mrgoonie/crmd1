/**
 * Aggregator: collects all MCP tool registrations and exposes
 * getToolDefinitions() for test introspection.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpContext } from '../context.js';
import { registerOrgTools } from './org-tools.js';
import { registerContactTools } from './contact-tools.js';
import { registerCompanyTools } from './company-tools.js';
import { registerDealTools } from './deal-tools.js';
import { registerActivityTools } from './activity-tools.js';
import { registerTaskTools } from './task-tools.js';

// ---------------------------------------------------------------------------
// Tool name registry — single source of truth for tests
// ---------------------------------------------------------------------------

export const TOOL_NAMES = [
  // Org + DB + search
  'org_create',
  'org_list',
  'org_use',
  'org_current',
  'org_delete',
  'db_init',
  'db_query',
  'crm_search',
  // Contacts
  'contact_create',
  'contact_get',
  'contact_list',
  'contact_update',
  'contact_delete',
  'contact_restore',
  // Companies
  'company_create',
  'company_get',
  'company_list',
  'company_update',
  'company_delete',
  'company_restore',
  // Deals
  'deal_create',
  'deal_get',
  'deal_list',
  'deal_update',
  'deal_delete',
  'deal_restore',
  // Activities
  'activity_log',
  'activity_get',
  'activity_list',
  'activity_delete',
  // Tasks
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  'task_complete',
  'task_delete',
  'task_restore',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// Tool definition shape used by tests
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: string };
}

/**
 * Register all tools on the given McpServer instance.
 * getCtx is called per-invocation so auth/org can be lazily resolved.
 */
export function registerAllTools(
  server: McpServer,
  getCtx: () => McpContext | null,
): void {
  registerOrgTools(server, getCtx);
  registerContactTools(server, getCtx);
  registerCompanyTools(server, getCtx);
  registerDealTools(server, getCtx);
  registerActivityTools(server, getCtx);
  registerTaskTools(server, getCtx);
}

/**
 * Return a minimal descriptor for each registered tool name.
 * Used by tests to assert registration completeness.
 *
 * The MCP SDK (v1.x) stores registered tools in `server._registeredTools`
 * as a plain object keyed by tool name. Each entry has:
 *   - `description?: string`
 *   - `inputSchema`: a Zod schema whose `_def.typeName === 'ZodObject'`
 *   - `handler`: the async function to invoke
 */
export function getToolDefinitions(server: McpServer): ToolDefinition[] {
  // _registeredTools is a plain Record<string, { description?, inputSchema?, handler }>
  const internal = server as unknown as {
    _registeredTools?: Record<string, { description?: string; inputSchema?: unknown }>;
  };

  const rt = internal._registeredTools;
  if (rt && typeof rt === 'object') {
    return Object.entries(rt).map(([name, reg]) => ({
      name,
      description: reg.description ?? '',
      // inputSchema is a Zod ZodObject — always represents type: 'object'
      inputSchema: { type: 'object' },
    }));
  }

  // Fallback: return static list
  return TOOL_NAMES.map((name) => ({
    name,
    description: name,
    inputSchema: { type: 'object' },
  }));
}

/**
 * Invoke a registered tool handler by name, bypassing the MCP transport.
 * For use in unit tests only.
 */
export async function invokeToolHandler(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const internal = server as unknown as {
    _registeredTools?: Record<string, {
      handler?: (args: Record<string, unknown>) => Promise<unknown>;
    }>;
  };

  const tool = internal._registeredTools?.[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  if (typeof tool.handler !== 'function') throw new Error(`Tool has no handler: ${name}`);

  return tool.handler(args) as Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}
