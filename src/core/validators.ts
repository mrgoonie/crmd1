/**
 * Zod schemas for shared input validation primitives.
 * Full entity row schemas (Contact, Company, Deal, etc.) added in Phase 05.
 * Use z.infer<typeof Schema> to derive TypeScript types — single source of truth.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitive field schemas
// ---------------------------------------------------------------------------

/** Org slug: lowercase alphanumeric + hyphens, 1–63 chars, must start with alnum. */
export const OrgSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Org slug must be lowercase alphanumeric with hyphens (max 63 chars)');

export type OrgSlug = z.infer<typeof OrgSlugSchema>;

/** RFC 5321 email validated by Zod's built-in check. */
export const EmailSchema = z.string().email('Invalid email address');

export type Email = z.infer<typeof EmailSchema>;

/**
 * Hostname / domain (e.g. "example.com").
 * Accepts labels of 1–63 chars, total ≤ 253 chars, no protocol prefix.
 */
export const DomainSchema = z
  .string()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
    'Invalid domain (e.g. example.com)',
  )
  .max(253, 'Domain exceeds max length of 253 characters');

export type Domain = z.infer<typeof DomainSchema>;

/** ISO 4217 three-letter currency code (uppercase). */
export const CurrencySchema = z
  .string()
  .length(3, 'Currency must be a 3-letter ISO 4217 code')
  .regex(/^[A-Z]{3}$/, 'Currency must be uppercase letters (e.g. USD, EUR)');

export type Currency = z.infer<typeof CurrencySchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
});

export type Pagination = z.infer<typeof PaginationSchema>;

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

export const IdempotencyKeySchema = z.string().min(1).max(128).optional();

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

// ---------------------------------------------------------------------------
// Entity type enum
// ---------------------------------------------------------------------------

export const EntityTypeSchema = z.enum([
  'contact',
  'company',
  'deal',
  'activity',
  'task',
]);

export type EntityType = z.infer<typeof EntityTypeSchema>;

// ---------------------------------------------------------------------------
// Shared audit fields (all optional on input — DB sets them)
// ---------------------------------------------------------------------------

export const AuditFieldsSchema = z.object({
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  deleted_at: z.string().datetime().nullable().optional(),
  created_by: z.string().optional(),
  updated_by: z.string().optional(),
});

export type AuditFields = z.infer<typeof AuditFieldsSchema>;

// ---------------------------------------------------------------------------
// Custom fields (open-ended JSON object, validated at boundary)
// ---------------------------------------------------------------------------

export const CustomFieldsSchema = z.record(z.string(), z.unknown()).optional();

export type CustomFields = z.infer<typeof CustomFieldsSchema>;
