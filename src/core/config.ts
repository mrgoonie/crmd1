/**
 * Config file management: read/write ~/.config/crmd1/config.json
 * Atomic writes (tmp + rename) with 0600 perms on POSIX.
 * Token/account resolution: flag > env > config file.
 */

import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { CrmdError, ErrorCode } from './errors.js';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const OrgEntrySchema = z.object({
  database_id: z.string().min(1),
  database_name: z.string().min(1),
  created_at: z.string().min(1),
});

export const ConfigSchema = z.object({
  version: z.literal(1),
  account_id: z.string().optional(),
  token: z.string().optional(),
  active_org: z.string().optional(),
  orgs: z.record(z.string(), OrgEntrySchema).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type OrgEntry = z.infer<typeof OrgEntrySchema>;

const CONFIG_DEFAULTS: Config = { version: 1, orgs: {} };

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function configDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (!appData) throw new CrmdError(ErrorCode.INTERNAL, '%APPDATA% is not set on Windows');
    return join(appData, 'crmd1');
  }
  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'crmd1');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export async function loadConfig(): Promise<Config> {
  const p = configPath();
  try {
    const raw = await readFile(p, 'utf8');
    const parsed = ConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn('Config file failed validation, using defaults', { path: p });
      return { ...CONFIG_DEFAULTS };
    }
    return parsed.data;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return { ...CONFIG_DEFAULTS };
    }
    throw new CrmdError(ErrorCode.INTERNAL, 'Failed to read config file', {
      cause: err,
      details: { path: p },
    });
  }
}

export async function saveConfig(c: Config): Promise<void> {
  const dir = configDir();
  const p = configPath();
  const tmp = p + '.tmp';

  try {
    await mkdir(dir, { recursive: true });
    const content = JSON.stringify(c, null, 2) + '\n';
    await writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, p);
    // Best-effort chmod — silently skipped on Windows
    if (process.platform !== 'win32') {
      await chmod(p, 0o600).catch(() => {
        logger.warn('Could not set 0600 perms on config file', { path: p });
      });
    }
  } catch (err: unknown) {
    throw new CrmdError(ErrorCode.INTERNAL, 'Failed to write config file', {
      cause: err,
      details: { path: p },
    });
  }
}

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

export interface ResolveAuthOpts {
  flagToken?: string;
  flagAccountId?: string;
}

export interface Auth {
  token: string;
  account_id: string;
}

/**
 * Resolve token: flag > CLOUDFLARE_API_TOKEN env > config.token
 * Throws AUTH_MISSING if nothing found.
 */
export async function getAuth(opts: ResolveAuthOpts = {}): Promise<Auth> {
  const token =
    opts.flagToken ||
    process.env['CLOUDFLARE_API_TOKEN'] ||
    (await loadConfig()).token;

  const account_id =
    opts.flagAccountId ||
    process.env['CLOUDFLARE_ACCOUNT_ID'] ||
    (await loadConfig()).account_id;

  if (!token) {
    throw new CrmdError(
      ErrorCode.AUTH_MISSING,
      'No API token found. Set CLOUDFLARE_API_TOKEN or run: crmd1 auth login',
    );
  }
  if (!account_id) {
    throw new CrmdError(
      ErrorCode.AUTH_MISSING,
      'No account ID found. Set CLOUDFLARE_ACCOUNT_ID or run: crmd1 auth login',
    );
  }

  return { token, account_id };
}

// ---------------------------------------------------------------------------
// Org helpers
// ---------------------------------------------------------------------------

export function getActiveOrg(c: Config): { slug: string } & OrgEntry {
  const slug = c.active_org;
  if (!slug) {
    throw new CrmdError(ErrorCode.ORG_NOT_FOUND, 'No active org set. Run: crmd1 org use <slug>');
  }
  const entry = c.orgs[slug];
  if (!entry) {
    throw new CrmdError(ErrorCode.ORG_NOT_FOUND, `Active org "${slug}" not found in config`);
  }
  return { slug, ...entry };
}

export async function setActiveOrg(slug: string): Promise<void> {
  const c = await loadConfig();
  if (!c.orgs[slug]) {
    throw new CrmdError(ErrorCode.ORG_NOT_FOUND, `Org "${slug}" not found`);
  }
  await saveConfig({ ...c, active_org: slug });
}

export async function addOrg(slug: string, dbId: string, dbName: string): Promise<void> {
  const c = await loadConfig();
  if (c.orgs[slug]) {
    throw new CrmdError(ErrorCode.ORG_EXISTS, `Org "${slug}" already exists`);
  }
  const orgs = { ...c.orgs, [slug]: { database_id: dbId, database_name: dbName, created_at: new Date().toISOString() } };
  await saveConfig({ ...c, orgs });
}

export async function removeOrg(slug: string): Promise<void> {
  const c = await loadConfig();
  if (!c.orgs[slug]) {
    throw new CrmdError(ErrorCode.ORG_NOT_FOUND, `Org "${slug}" not found`);
  }
  const orgs = { ...c.orgs };
  delete orgs[slug];
  const active_org = c.active_org === slug ? undefined : c.active_org;
  await saveConfig({ ...c, orgs, active_org });
}

export async function listOrgs(c?: Config): Promise<Array<{ slug: string } & OrgEntry>> {
  const cfg = c ?? await loadConfig();
  return Object.entries(cfg.orgs).map(([slug, entry]) => ({ slug, ...entry }));
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function isNodeError(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e;
}
