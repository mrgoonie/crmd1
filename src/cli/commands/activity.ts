/**
 * CLI subcommands: activity log|get|list|delete
 * Activities are append-only — no update command.
 */

import type { Command } from 'commander';
import { printOk, printErr } from '../output.js';
import { runAction, resolveAuthAndOrg } from '../runtime.js';
import { crm } from '../../core/index.js';

export function registerActivityCommands(program: Command): void {
  const activity = program.command('activity').description('Manage activities (append-only)');

  activity
    .command('log')
    .description('Log a new activity')
    .requiredOption('--entity-type <type>', 'Linked entity type: contact|company|deal')
    .requiredOption('--entity-id <id>', 'Linked entity ID')
    .requiredOption('--type <type>', 'Activity type: call|email|meeting|note|task_completed|demo|follow_up|other')
    .requiredOption('--summary <text>', 'Activity summary')
    .option('--follow-up <date>', 'Next follow-up date (YYYY-MM-DD)')
    .option('--metadata <json>', 'Extra metadata as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.activityCreate(
          client,
          {
            entity_type: opts['entityType'] as 'contact' | 'company' | 'deal',
            entity_id: opts['entityId'] ?? '',
            activity_type: opts['type'] as 'call',
            summary: opts['summary'] ?? '',
            next_follow_up_date: opts['followUp'],
            metadata: parseJsonOpt(opts['metadata']),
          },
          { idempotency_key: opts['idempotencyKey'] },
        );
        await printOk(result);
      });
    });

  activity
    .command('get <id>')
    .description('Get an activity by ID')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.activityGet(client, id));
      });
    });

  activity
    .command('list')
    .description('List activities')
    .option('--entity-type <type>', 'Filter by entity type')
    .option('--entity-id <id>', 'Filter by entity ID')
    .option('--type <type>', 'Filter by activity type')
    .option('--limit <n>', 'Page size (default 50)', '50')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--include-deleted', 'Include soft-deleted activities')
    .action((opts: Record<string, string | boolean>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.activityList(client, {
          entity_type: opts['entityType'] as 'contact' | undefined,
          entity_id: opts['entityId'] as string | undefined,
          activity_type: opts['type'] as 'call' | undefined,
          limit: opts['limit'] ? parseInt(opts['limit'] as string, 10) : undefined,
          cursor: opts['cursor'] as string | undefined,
          include_deleted: opts['includeDeleted'] === true,
        });
        await printOk(result.items, {
          columns: ['id', 'activity_type', 'entity_type', 'entity_id', 'summary', 'created_at'],
        });
      });
    });

  activity
    .command('delete <id>')
    .description('Soft-delete an activity')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.activitySoftDelete(client, id));
      });
    });
}

function parseJsonOpt(val: string | undefined): Record<string, unknown> | undefined {
  if (!val) return undefined;
  try {
    const parsed: unknown = JSON.parse(val);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('--metadata must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    printErr(e);
  }
}
