/**
 * CLI runtime helpers: auth resolution, active org lookup, action wrapper.
 * Used by every command to avoid boilerplate.
 */

import { D1Client, getAuth, resolveActiveOrg } from '../core/index.js';
import { printErr } from './output.js';

// ---------------------------------------------------------------------------
// Global flags (injected by cli/index.ts before commands run)
// ---------------------------------------------------------------------------

interface GlobalFlags {
  token?: string;
  account?: string;
}

let _globalFlags: GlobalFlags = {};

export function setGlobalFlags(flags: GlobalFlags): void {
  _globalFlags = flags;
}

export function getGlobalFlags(): GlobalFlags {
  return _globalFlags;
}

// ---------------------------------------------------------------------------
// Auth + org resolution
// ---------------------------------------------------------------------------

export interface ResolvedContext {
  client: D1Client;
  slug: string;
  dbId: string;
}

/**
 * Resolves auth credentials and active org, returns a D1Client bound to the org DB.
 * Throws CrmdError on any failure — caller wraps with runAction.
 */
export async function resolveAuthAndOrg(): Promise<ResolvedContext> {
  const flags = _globalFlags;
  const auth = await getAuth({
    flagToken: flags.token,
    flagAccountId: flags.account,
  });

  const baseClient = new D1Client({
    token: auth.token,
    accountId: auth.account_id,
  });

  const org = await resolveActiveOrg();

  return {
    client: baseClient.withDatabase(org.database_id),
    slug: org.slug,
    dbId: org.database_id,
  };
}

/**
 * Returns a base D1Client (not bound to any org DB) — for management operations.
 */
export async function resolveBaseClient(): Promise<D1Client> {
  const flags = _globalFlags;
  const auth = await getAuth({
    flagToken: flags.token,
    flagAccountId: flags.account,
  });
  return new D1Client({ token: auth.token, accountId: auth.account_id });
}

// ---------------------------------------------------------------------------
// Action wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps an async command handler with top-level error handling.
 * On error: printErr (which exits with appropriate code).
 */
export function runAction(fn: () => Promise<void>): void {
  fn().catch((e: unknown) => printErr(e));
}
