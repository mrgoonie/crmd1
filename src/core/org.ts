/**
 * High-level org management: create/list/use/delete orgs.
 * Combines D1 management API + local config persistence.
 * Org = one Cloudflare D1 database named "crmd1-{slug}".
 */

import { D1Client } from './d1-client.js';
import { createDatabase, deleteDatabase } from './d1-management.js';
import { CrmdError, ErrorCode } from './errors.js';
import { logger } from './logger.js';
import {
  loadConfig,
  addOrg,
  removeOrg,
  listOrgs as configListOrgs,
  getActiveOrg,
  type Config,
  type OrgEntry,
} from './config.js';
import { OrgSlugSchema } from './validators.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrgInfo extends OrgEntry {
  slug: string;
  active: boolean;
}

export interface CreateOrgResult {
  slug: string;
  database_id: string;
  database_name: string;
}

export interface ApplySchemaFn {
  (client: D1Client): Promise<void>;
}

export interface CreateOrgOpts {
  /** If provided, will be called after DB creation to apply schema. */
  applySchema?: ApplySchemaFn;
}

export interface DeleteOrgOpts {
  /** If true, also deletes the Cloudflare D1 database. */
  dropDatabase?: boolean;
}

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/**
 * Normalise an arbitrary string to a valid org slug.
 * Lowercase, keep [a-z0-9], replace everything else with '-', collapse and trim.
 */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

  if (!slug) {
    throw new CrmdError(ErrorCode.INVALID_INPUT, 'Slug is empty after normalization');
  }
  return slug;
}

// ---------------------------------------------------------------------------
// Org operations (all accept injected D1Client + optional Config for testing)
// ---------------------------------------------------------------------------

/**
 * Create a new org: validate slug, provision D1 DB, persist to config,
 * optionally apply schema via callback.
 */
export async function createOrg(
  client: D1Client,
  slug: string,
  opts: CreateOrgOpts = {},
): Promise<CreateOrgResult> {
  // Validate slug format
  const parsed = OrgSlugSchema.safeParse(slug);
  if (!parsed.success) {
    throw new CrmdError(
      ErrorCode.INVALID_INPUT,
      `Invalid org slug: ${parsed.error.issues[0]?.message ?? 'invalid format'}`,
      { details: { slug } },
    );
  }

  // Check config collision first (cheap)
  const config = await loadConfig();
  if (config.orgs[slug]) {
    throw new CrmdError(ErrorCode.ORG_EXISTS, `Org "${slug}" already exists`);
  }

  const dbName = `crmd1-${slug}`;
  logger.info('Creating D1 database', { name: dbName });

  // Provision DB — may throw ORG_EXISTS (409) if CF already has it
  let db: { uuid: string; name: string };
  try {
    db = await createDatabase(client, dbName);
  } catch (err) {
    // Re-throw as-is; caller sees CrmdError with correct code
    throw err;
  }

  // Persist to config
  await addOrg(slug, db.uuid, db.name);
  logger.info('Org created', { slug, database_id: db.uuid });

  // Optionally apply schema
  if (opts.applySchema) {
    const boundClient = client.withDatabase(db.uuid);
    try {
      await opts.applySchema(boundClient);
    } catch (schemaErr) {
      logger.error('Schema apply failed after DB creation — attempting rollback', {
        slug,
        database_id: db.uuid,
      });
      // Best-effort rollback: delete the DB and remove from config
      try {
        await deleteDatabase(client, db.uuid);
      } catch (deleteErr) {
        logger.error('Rollback deleteDb failed', { database_id: db.uuid, err: String(deleteErr) });
      }
      try {
        await removeOrg(slug);
      } catch (removeErr) {
        logger.error('Rollback removeOrg failed', { slug, err: String(removeErr) });
      }
      throw schemaErr;
    }
  }

  return { slug, database_id: db.uuid, database_name: db.name };
}

/** List all orgs from local config, annotated with active flag. */
export async function listOrgs(config?: Config): Promise<OrgInfo[]> {
  const cfg = config ?? (await loadConfig());
  const entries = await configListOrgs(cfg);
  const active = cfg.active_org;
  return entries.map((e) => ({ ...e, active: e.slug === active }));
}

/**
 * Set the active org. Slug must exist in config.
 * (Thin wrapper — setActiveOrg already lives in config.ts)
 */
export async function useOrg(slug: string): Promise<void> {
  const { setActiveOrg } = await import('./config.js');
  await setActiveOrg(slug);
}

/**
 * Delete an org from config (and optionally from Cloudflare D1).
 */
export async function deleteOrg(
  client: D1Client,
  slug: string,
  opts: DeleteOrgOpts = {},
): Promise<void> {
  const config = await loadConfig();
  const entry = config.orgs[slug];
  if (!entry) {
    throw new CrmdError(ErrorCode.ORG_NOT_FOUND, `Org "${slug}" not found`);
  }

  if (opts.dropDatabase) {
    logger.info('Deleting D1 database', { uuid: entry.database_id });
    await deleteDatabase(client, entry.database_id);
  }

  await removeOrg(slug);
  logger.info('Org deleted', { slug });
}

/**
 * Read active org from config; throw ORG_NOT_FOUND if none set.
 */
export async function resolveActiveOrg(
  config?: Config,
): Promise<{ slug: string } & OrgEntry> {
  const cfg = config ?? (await loadConfig());
  return getActiveOrg(cfg);
}

/**
 * Returns a D1Client pre-bound to the active org's database.
 */
export async function getClientForActiveOrg(baseClient: D1Client): Promise<D1Client> {
  const org = await resolveActiveOrg();
  return baseClient.withDatabase(org.database_id);
}
