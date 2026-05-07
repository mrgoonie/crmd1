/**
 * Public API barrel for src/core/.
 * Import from here to get stable, tree-shakeable access to all core primitives.
 */

export * from './errors.js';
export * from './ids.js';
export * from './logger.js';
export * from './config.js';
export * from './validators.js';
export * from './d1-client.js';
export * from './d1-management.js';
// org.ts re-exports listOrgs under the same name as config.ts — export named to avoid collision.
export {
  slugify,
  createOrg,
  listOrgs,
  useOrg,
  deleteOrg,
  resolveActiveOrg,
  getClientForActiveOrg,
} from './org.js';
export type { OrgInfo, CreateOrgResult, ApplySchemaFn, CreateOrgOpts, DeleteOrgOpts } from './org.js';
export * from './schema.js';
export * from './db-init.js';
export * as crm from './crm/index.js';
