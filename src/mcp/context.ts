/**
 * MCP context: resolves auth and active org from env vars only.
 * No interactive flow; MCP processes are non-interactive by design.
 *
 * Auth resolution order (MCP):
 *   1. CLOUDFLARE_API_TOKEN  env
 *   2. ~/.config/crmd1/config.json token field
 * Active org:
 *   1. CRMD1_ORG env
 *   2. config active_org
 */

import { D1Client } from '../core/d1-client.js';
import { getAuth, loadConfig, getActiveOrg } from '../core/config.js';
import { CrmdError, ErrorCode } from '../core/errors.js';
import { logger } from '../core/logger.js';

export interface McpContext {
  /** D1Client bound to active org database. */
  client: D1Client;
  /** Base D1Client (no db binding) — for org management ops. */
  baseClient: D1Client;
  /** Active org slug. */
  slug: string;
  /** Active database ID. */
  dbId: string;
}

/**
 * Build the MCP context from environment variables + config file.
 * Returns null on missing auth instead of throwing — callers return AUTH_MISSING errors.
 */
export async function buildMcpContext(): Promise<McpContext | null> {
  let auth: { token: string; account_id: string };
  try {
    auth = await getAuth({});
  } catch (err) {
    if (err instanceof CrmdError && err.code === ErrorCode.AUTH_MISSING) {
      logger.info('MCP starting without auth credentials; tool calls will return AUTH_MISSING');
      return null;
    }
    throw err;
  }

  const baseClient = new D1Client({ token: auth.token, accountId: auth.account_id });

  // Resolve org: env override > config active_org
  const orgOverride = process.env['CRMD1_ORG'];
  let slug: string;
  let dbId: string;

  try {
    const config = await loadConfig();

    if (orgOverride) {
      const entry = config.orgs[orgOverride];
      if (!entry) {
        throw new CrmdError(
          ErrorCode.ORG_NOT_FOUND,
          `CRMD1_ORG="${orgOverride}" not found in config`,
        );
      }
      slug = orgOverride;
      dbId = entry.database_id;
    } else {
      const active = getActiveOrg(config);
      slug = active.slug;
      dbId = active.database_id;
    }
  } catch (err) {
    if (err instanceof CrmdError && err.code === ErrorCode.ORG_NOT_FOUND) {
      logger.info('MCP starting without active org; tool calls will return ORG_NOT_FOUND', {
        orgOverride,
      });
      return null;
    }
    throw err;
  }

  logger.info('MCP context ready', { slug, dbId: dbId.slice(0, 8) + '...' });
  return {
    client: baseClient.withDatabase(dbId),
    baseClient,
    slug,
    dbId,
  };
}

/**
 * Returns AUTH_MISSING error result for tools when context is unavailable.
 */
export function missingContextResult(what: 'auth' | 'org'): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const err =
    what === 'auth'
      ? new CrmdError(
          ErrorCode.AUTH_MISSING,
          'No API credentials found. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.',
        )
      : new CrmdError(
          ErrorCode.ORG_NOT_FOUND,
          'No active org. Set CRMD1_ORG env var or run: crmd1 org use <slug>',
        );
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(err.toJSON()) }],
    isError: true,
  };
}
