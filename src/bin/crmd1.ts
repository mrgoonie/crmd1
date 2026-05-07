/**
 * CLI entry point — delegates to cli/index.ts runCli.
 * Shebang is injected by tsup banner config; do not add one here.
 */
import { runCli } from '../cli/index.js';

runCli(process.argv);
