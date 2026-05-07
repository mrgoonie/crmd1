/**
 * CLI subcommands: db init | db version | db query <sql>
 * Delegates to core initDatabase / getSchemaVersion / D1Client.query.
 */

import type { Command } from 'commander';
import { printOk, printErr } from '../output.js';
import { runAction, resolveAuthAndOrg, resolveBaseClient } from '../runtime.js';
import {
  initDatabase,
  getSchemaVersion,
  resolveActiveOrg,
  getAuth,
  D1Client,
} from '../../core/index.js';

export function registerDbCommands(program: Command): void {
  const db = program.command('db').description('Database management');

  // db init
  db
    .command('init')
    .description('Initialise (or migrate) the active org database schema')
    .action(() => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await initDatabase(client);
        await printOk(result);
      });
    });

  // db version
  db
    .command('version')
    .description('Print current schema version for the active org database')
    .action(() => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const version = await getSchemaVersion(client);
        await printOk({ schema_version: version });
      });
    });

  // db query <sql>
  db
    .command('query <sql>')
    .description('Execute a raw SQL query (escape hatch — use with caution)')
    .option('--params <json>', 'Bound parameters as a JSON array, e.g. \'["val1",2]\'')
    .option('--allow-multi', 'Allow multi-statement SQL (dangerous — use with care)')
    .action((sql: string, opts: { params?: string; allowMulti?: boolean }) => {
      runAction(async () => {
        // Refuse multi-statement unless --allow-multi
        if (!opts.allowMulti && /;\s*\S/.test(sql)) {
          printErr(
            Object.assign(new Error('Multi-statement SQL is not allowed without --allow-multi'), {
              code: 'INVALID_INPUT',
            }),
          );
        }

        let params: unknown[] = [];
        if (opts.params) {
          try {
            const parsed: unknown = JSON.parse(opts.params);
            if (!Array.isArray(parsed)) throw new Error('--params must be a JSON array');
            params = parsed;
          } catch (e) {
            printErr(e);
          }
        }

        process.stderr.write(
          '\x1b[33mWarning: raw query bypasses all validation and soft-delete filters.\x1b[0m\n',
        );

        const { client } = await resolveAuthAndOrg();
        const result = await client.query(sql, params);
        await printOk(result.results.length > 0 ? result.results : { rows_written: result.meta.rows_written });
      });
    });
}
