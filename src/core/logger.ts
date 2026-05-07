/**
 * Minimal diagnostic logger for core/.
 * ALL output goes to stderr — stdout is reserved for CLI data and MCP JSON-RPC.
 * Level controlled by CRMD1_LOG env var (debug|info|warn|error). Default: warn.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function resolveLevel(): number {
  const raw = (process.env['CRMD1_LOG'] ?? 'warn').toLowerCase().trim();
  return (LEVELS as Record<string, number>)[raw] ?? LEVELS.warn;
}

function write(level: Level, message: string, extra?: unknown): void {
  const activeLevel = resolveLevel();
  if (LEVELS[level] < activeLevel) return;

  const label = level.toUpperCase().padEnd(5);
  let line = `[crmd1] ${label} ${message}`;

  if (extra !== undefined) {
    try {
      line += ' ' + JSON.stringify(extra);
    } catch {
      line += ' [unserializable extra]';
    }
  }

  process.stderr.write(line + '\n');
}

/** Redact a token value — show only last 4 chars. */
export function redactToken(token: string): string {
  if (token.length <= 4) return '****';
  return `****${token.slice(-4)}`;
}

export const logger = {
  debug(message: string, extra?: unknown): void {
    write('debug', message, extra);
  },
  info(message: string, extra?: unknown): void {
    write('info', message, extra);
  },
  warn(message: string, extra?: unknown): void {
    write('warn', message, extra);
  },
  error(message: string, extra?: unknown): void {
    write('error', message, extra);
  },
};
