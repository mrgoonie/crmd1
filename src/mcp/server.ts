/**
 * MCP stdio server for crmd1.
 * Builds McpServer with StdioServerTransport, registers all tools,
 * and connects. Auth/org context is resolved lazily per-call so the
 * server starts even if credentials are absent.
 *
 * IMPORTANT: nothing in this file may write to stdout — that stream
 * is owned by the JSON-RPC framing layer.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpContext } from './context.js';
import { registerAllTools } from './tools/index.js';
import { logger } from '../core/logger.js';
import type { McpContext } from './context.js';

// ---------------------------------------------------------------------------
// Package version — injected at build time by tsup define: __PKG_VERSION__
// Declared here for TypeScript; tsup replaces the string at bundle time.
// ---------------------------------------------------------------------------

declare const __PKG_VERSION__: string;

function getVersion(): string {
  try {
    return __PKG_VERSION__;
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Build and connect the MCP stdio server.
 * Returns the McpServer instance (useful for tests).
 */
export async function start(): Promise<McpServer> {
  const version = getVersion();
  logger.info('crmd1-mcp starting', { version });

  // Attempt context load — null means missing auth/org; tools handle it per-call
  let ctx: McpContext | null = null;
  try {
    ctx = await buildMcpContext();
  } catch (err) {
    logger.error('Unexpected error building MCP context', { err: String(err) });
    // Continue; tools will return AUTH_MISSING / ORG_NOT_FOUND as appropriate
  }

  const server = new McpServer(
    { name: 'crmd1', version },
    { capabilities: { tools: {} } },
  );

  // Register all tools with a getter so context can be refreshed if needed
  registerAllTools(server, () => ctx);

  const transport = new StdioServerTransport();

  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = async (signal: string) => {
    logger.info('crmd1-mcp shutting down', { signal });
    await server.close();
    process.exit(0);
  };

  process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });
  process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });

  await server.connect(transport);
  logger.info('crmd1-mcp connected via stdio');

  return server;
}
