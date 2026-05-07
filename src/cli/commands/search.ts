/**
 * CLI subcommand: search <q> [--types ...] [--limit] [--cursor]
 * Delegates to core crm.crmSearch (FTS5).
 */

import type { Command } from 'commander';
import { printOk } from '../output.js';
import { runAction, resolveAuthAndOrg } from '../runtime.js';
import { crm } from '../../core/index.js';

export function registerSearchCommands(program: Command): void {
  program
    .command('search <q>')
    .description('Full-text search across contacts, companies, deals, activities, tasks')
    .option(
      '--types <types>',
      'Comma-separated entity types to search: contact,company,deal,activity,task',
    )
    .option('--limit <n>', 'Page size (default 50)', '50')
    .option('--cursor <cursor>', 'Pagination cursor')
    .action((q: string, opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();

        const types = opts['types']
          ? (opts['types'].split(',').map((t) => t.trim()) as Array<
              'contact' | 'company' | 'deal' | 'activity' | 'task'
            >)
          : undefined;

        const result = await crm.crmSearch(client, {
          q,
          types,
          limit: opts['limit'] ? parseInt(opts['limit'], 10) : undefined,
          cursor: opts['cursor'],
        });

        await printOk(result.items, { columns: ['entity_type', 'entity_id', 'snippet', 'rank'] });
      });
    });
}
