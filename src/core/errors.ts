/**
 * Core error primitives: CrmdError class, error codes, serialization.
 * All thrown errors from core/ must be CrmdError instances.
 */

export const ErrorCode = {
  AUTH_MISSING: 'AUTH_MISSING',
  AUTH_INVALID: 'AUTH_INVALID',
  ORG_NOT_FOUND: 'ORG_NOT_FOUND',
  ORG_EXISTS: 'ORG_EXISTS',
  DB_INIT_REQUIRED: 'DB_INIT_REQUIRED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_INPUT: 'INVALID_INPUT',
  RATE_LIMIT: 'RATE_LIMIT',
  DB_ERROR: 'DB_ERROR',
  NETWORK: 'NETWORK',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Codes that are safe to retry without user intervention */
const RETRYABLE_CODES: Set<ErrorCodeValue> = new Set([
  ErrorCode.RATE_LIMIT,
  ErrorCode.NETWORK,
]);

export interface CrmdErrorOptions {
  details?: Record<string, unknown>;
  retryable?: boolean;
  retry_after_ms?: number;
  cause?: unknown;
}

export class CrmdError extends Error {
  readonly code: ErrorCodeValue;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
  readonly retry_after_ms?: number;
  override readonly cause?: unknown;

  constructor(code: ErrorCodeValue, message: string, opts?: CrmdErrorOptions) {
    super(message);
    this.name = 'CrmdError';
    this.code = code;
    this.details = opts?.details;
    this.retry_after_ms = opts?.retry_after_ms;
    this.cause = opts?.cause;
    // caller can override retryability; fall back to code-based default
    this.retryable = opts?.retryable ?? RETRYABLE_CODES.has(code);

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): {
    ok: false;
    error: {
      code: string;
      message: string;
      retryable: boolean;
      details?: Record<string, unknown>;
      retry_after_ms?: number;
    };
  } {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.details !== undefined && { details: this.details }),
        ...(this.retry_after_ms !== undefined && { retry_after_ms: this.retry_after_ms }),
      },
    };
  }
}

export interface SerializedError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Serialize any unknown thrown value to a stable shape.
 * Safe to pass to JSON.stringify at error boundaries.
 *
 * ZodError slipping past parseInput() is mapped to INVALID_INPUT defensively.
 * Detected via e.name === 'ZodError' to avoid a hard zod import here.
 */
export function serializeError(e: unknown): SerializedError {
  if (e instanceof CrmdError) {
    return {
      code: e.code,
      message: e.message,
      retryable: e.retryable,
      ...(e.details !== undefined && { details: e.details }),
    };
  }
  // Defensive: ZodError should be caught by parseInput(), but handle it here too
  if (e instanceof Error && e.name === 'ZodError') {
    const zodErr = e as Error & { issues?: Array<{ path: (string | number)[]; message: string }> };
    const issues = zodErr.issues?.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return {
      code: ErrorCode.INVALID_INPUT,
      message: `Validation failed: ${e.message}`,
      retryable: false,
      ...(issues !== undefined && { details: { issues } }),
    };
  }
  if (e instanceof Error) {
    return { code: ErrorCode.INTERNAL, message: e.message, retryable: false };
  }
  return {
    code: ErrorCode.INTERNAL,
    message: String(e),
    retryable: false,
  };
}

/** Convenience: is this error code retryable by default? */
export function isRetryable(code: ErrorCodeValue): boolean {
  return RETRYABLE_CODES.has(code);
}
