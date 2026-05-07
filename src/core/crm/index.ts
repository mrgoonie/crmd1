/**
 * CRM module barrel — aggregates all entity CRUD + search exports.
 * Import via: import { crm } from '../core/index.js'
 * or directly: import * from './crm/index.js'
 */

export * from './contacts.js';
export * from './companies.js';
export * from './deals.js';
export * from './activities.js';
export * from './tasks.js';
export * from './search.js';
export * from './internal/cursor.js';
export * from './internal/idempotency.js';
export * from './internal/sql.js';
