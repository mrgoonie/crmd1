/**
 * CLI program entry: builds the commander Program, registers all subcommands,
 * wires global flags, and exports runCli for the bin entry point.
 */

import { Command } from 'commander';
import { setJsonMode, printErr } from './output.js';
import { setGlobalFlags } from './runtime.js';
import { registerOrgCommands } from './commands/org.js';
import { registerDbCommands } from './commands/db.js';
import { registerContactCommands } from './commands/contact.js';
import { registerCompanyCommands } from './commands/company.js';
import { registerDealCommands } from './commands/deal.js';
import { registerActivityCommands } from './commands/activity.js';
import { registerTaskCommands } from './commands/task.js';
import { registerSearchCommands } from './commands/search.js';

// ---------------------------------------------------------------------------
// Version — injected at build time by tsup define: __PKG_VERSION__
// Declared here for TypeScript; tsup replaces the string at bundle time.
// ---------------------------------------------------------------------------

declare const __PKG_VERSION__: string;

function getVersion(): string {
  try {
    return __PKG_VERSION__;
  } catch {
    return '0.0.0';
  }
}

// ---------------------------------------------------------------------------
// Program factory (exported for testing)
// ---------------------------------------------------------------------------

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('crmd1')
    .description('CRM CLI backed by Cloudflare D1')
    .version(getVersion(), '-V, --version', 'Print version')
    // Global options inherited by all subcommands
    .option('--json', 'Force JSON output even on TTY')
    .option('--token <t>', 'Override CLOUDFLARE_API_TOKEN')
    .option('--account <id>', 'Override CLOUDFLARE_ACCOUNT_ID')
    .option('-v, --verbose', 'Increase log verbosity (-v = info, -vv = debug)', increaseVerbosity, 0)
    // Exit gracefully on unknown options rather than crashing
    .allowUnknownOption(false)
    .showHelpAfterError(true);

  // Register all subcommand groups
  registerOrgCommands(program);
  registerDbCommands(program);
  registerContactCommands(program);
  registerCompanyCommands(program);
  registerDealCommands(program);
  registerActivityCommands(program);
  registerTaskCommands(program);
  registerSearchCommands(program);

  return program;
}

function increaseVerbosity(_: unknown, prev: number): number {
  return (prev as number) + 1;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function runCli(argv: string[]): void {
  const program = buildProgram();

  // Apply global flags before any command action fires
  program.hook('preAction', () => {
    const opts = program.opts<{ json?: boolean; token?: string; account?: string; verbose?: number }>();

    if (opts.json) setJsonMode(true);

    setGlobalFlags({
      token: opts.token,
      account: opts.account,
    });

    // Set log level via env var (core/logger reads CRMD1_LOG)
    const v = opts.verbose ?? 0;
    if (v >= 2) process.env.CRMD1_LOG = 'debug';
    else if (v === 1) process.env.CRMD1_LOG = 'info';
  });

  program.parseAsync(argv).catch((err: unknown) => {
    // Commander throws on --help / --version (exitOverride not set, so it exits normally)
    // Other errors bubble here
    printErr(err);
  });
}
