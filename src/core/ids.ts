/**
 * ID generation and validation utilities.
 * Wraps uuidv7 for consistent UUID v7 usage across the codebase.
 */

import { uuidv7 } from 'uuidv7';

/** Generate a new UUID v7 (time-ordered, sortable). */
export function newId(): string {
  return uuidv7();
}

/**
 * Validate that a string is a well-formed UUID (any version).
 * Used for input guards before sending IDs to D1.
 */
export function isValidId(s: string): boolean {
  return UUID_REGEX.test(s);
}

/** Stricter check: UUID v7 starts with a timestamp-derived prefix (version nibble = 7). */
export function isUuidV7(s: string): boolean {
  return UUID_V7_REGEX.test(s);
}

// Standard UUID regex (8-4-4-4-12 hex groups)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UUID v7: version nibble at position 14 must be '7'
const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
