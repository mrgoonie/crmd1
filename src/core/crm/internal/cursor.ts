/**
 * Opaque cursor encoding/decoding for stable pagination.
 * Encodes { last_created_at, last_id } as base64url JSON.
 */

import { CrmdError, ErrorCode } from '../../errors.js';

export interface CursorData {
  last_created_at: string;
  last_id: string;
}

/** Encode cursor data to a base64url opaque string. */
export function encodeCursor(data: CursorData): string {
  const json = JSON.stringify(data);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/** Decode an opaque cursor string back to { last_created_at, last_id }. */
export function decodeCursor(s: string): CursorData {
  let json: string;
  try {
    json = Buffer.from(s, 'base64url').toString('utf8');
  } catch {
    throw new CrmdError(ErrorCode.INVALID_INPUT, 'Invalid pagination cursor (base64 decode failed)');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CrmdError(ErrorCode.INVALID_INPUT, 'Invalid pagination cursor (JSON parse failed)');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['last_created_at'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['last_id'] !== 'string'
  ) {
    throw new CrmdError(ErrorCode.INVALID_INPUT, 'Invalid pagination cursor (missing fields)');
  }

  const c = parsed as Record<string, string>;
  return { last_created_at: c['last_created_at']!, last_id: c['last_id']! };
}
