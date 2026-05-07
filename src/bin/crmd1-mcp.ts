/**
 * MCP server entry point.
 * Shebang is injected by tsup banner config; do not add one here.
 * Starts the stdio JSON-RPC server. All diagnostics go to stderr only —
 * stdout is owned by the MCP framing layer and must stay clean.
 */

import { start } from '../mcp/server.js';

start().catch((err: unknown) => {
  // Last-resort error handler: write to stderr and exit non-zero.
  // Never write to stdout here — that corrupts the JSON-RPC stream.
  process.stderr.write(
    `[crmd1-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
