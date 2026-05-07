/**
 * CLI output renderer: TTY → cli-table3 tables, non-TTY/--json → structured JSON.
 * Exit code map matches the architecture spec.
 */

import { serializeError, CrmdError, ErrorCode } from '../core/index.js';

// ---------------------------------------------------------------------------
// Global flags state (set by cli/index.ts before any command runs)
// ---------------------------------------------------------------------------

let _jsonMode = false;

export function setJsonMode(v: boolean): void {
  _jsonMode = v;
}

export function isInteractive(): boolean {
  return !!process.stdout.isTTY && !_jsonMode;
}

// ---------------------------------------------------------------------------
// Exit code map
// ---------------------------------------------------------------------------

const EXIT_CODES: Record<string, number> = {
  AUTH_MISSING: 2,
  AUTH_INVALID: 2,
  ORG_NOT_FOUND: 3,
  NOT_FOUND: 3,
  CONFLICT: 4,
  INVALID_INPUT: 5,
  RATE_LIMIT: 6,
  NETWORK: 7,
  DB_ERROR: 7,
};

function exitCodeFor(code: string): number {
  return EXIT_CODES[code] ?? 1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '';
  try {
    return new Date(s).toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// TTY table rendering (lazy import cli-table3)
// ---------------------------------------------------------------------------

async function renderTable(data: unknown[], columns?: string[]): Promise<void> {
  const { default: Table } = await import('cli-table3');
  const keys = columns ?? (data.length > 0 ? Object.keys(data[0] as Record<string, unknown>) : []);
  const table = new Table({ head: keys });
  for (const row of data) {
    const r = row as Record<string, unknown>;
    table.push(keys.map((k) => {
      const v = r[k];
      if (v == null) return '';
      if (typeof v === 'object') return truncate(JSON.stringify(v), 40);
      return truncate(String(v), 60);
    }));
  }
  process.stdout.write(table.toString() + '\n');
}

function renderKeyValue(obj: Record<string, unknown>): void {
  const entries = Object.entries(obj);
  const maxKey = Math.max(...entries.map(([k]) => k.length), 0);
  for (const [k, v] of entries) {
    const val = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    process.stdout.write(`  ${k.padEnd(maxKey)}  ${val}\n`);
  }
}

// ---------------------------------------------------------------------------
// Public output functions
// ---------------------------------------------------------------------------

export async function printOk(data: unknown, opts?: { columns?: string[] }): Promise<void> {
  if (!isInteractive()) {
    process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      process.stdout.write('(no results)\n');
      return;
    }
    if (typeof data[0] === 'object' && data[0] !== null) {
      await renderTable(data as unknown[], opts?.columns);
      return;
    }
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    renderKeyValue(data as Record<string, unknown>);
    return;
  }

  // Primitive fallback
  process.stdout.write(String(data) + '\n');
}

export function printErr(e: unknown): never {
  const err = serializeError(e);

  if (!isInteractive()) {
    process.stdout.write(JSON.stringify({ ok: false, error: err }) + '\n');
  } else {
    const msg = `\x1b[31mError [${err.code}]: ${err.message}\x1b[0m`;
    process.stderr.write(msg + '\n');
    if (err.details) {
      process.stderr.write('  ' + JSON.stringify(err.details) + '\n');
    }
  }

  process.exit(exitCodeFor(err.code));
}

export async function printResult(
  fn: () => Promise<unknown>,
  opts?: { columns?: string[] },
): Promise<void> {
  try {
    const data = await fn();
    await printOk(data, opts);
  } catch (e) {
    printErr(e);
  }
}

// Re-export for use in commands
export { ErrorCode, CrmdError };
