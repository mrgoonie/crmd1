/**
 * CLI subcommands: deal create|get|list|update|delete|restore
 */

import type { Command } from 'commander';
import { printOk, printErr } from '../output.js';
import { runAction, resolveAuthAndOrg } from '../runtime.js';
import { crm } from '../../core/index.js';

export function registerDealCommands(program: Command): void {
  const deal = program.command('deal').description('Manage deals');

  deal
    .command('create')
    .description('Create a new deal')
    .requiredOption('--title <title>', 'Deal title')
    .requiredOption('--company-id <id>', 'Company UUID')
    .option('--amount <n>', 'Deal amount')
    .option('--stage <stage>', 'Stage: prospect|qualified|proposal|negotiation|closed_won|closed_lost')
    .option('--close-date <date>', 'Expected close date (YYYY-MM-DD)')
    .option('--probability <n>', 'Win probability 0-100')
    .option('--owner <id>', 'Owner user ID')
    .option('--contacts <json>', 'Linked contact IDs as JSON array')
    .option('--notes <text>', 'Notes summary')
    .option('--custom <json>', 'Custom fields as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.dealCreate(
          client,
          {
            title: opts['title'] ?? '',
            company_id: opts['companyId'] ?? '',
            amount: opts['amount'] ? parseFloat(opts['amount']) : undefined,
            stage: opts['stage'] as 'prospect' | undefined,
            close_date: opts['closeDate'],
            probability: opts['probability'] ? parseInt(opts['probability'], 10) : undefined,
            owner_user_id: opts['owner'],
            linked_contacts: parseJsonArray(opts['contacts']),
            notes_summary: opts['notes'],
            custom_fields: parseJsonOpt(opts['custom']),
          },
          { idempotency_key: opts['idempotencyKey'] },
        );
        await printOk(result);
      });
    });

  deal
    .command('get <id>')
    .description('Get a deal by ID')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.dealGet(client, id));
      });
    });

  deal
    .command('list')
    .description('List deals')
    .option('--stage <stage>', 'Filter by stage')
    .option('--company-id <id>', 'Filter by company')
    .option('--contact-id <id>', 'Filter by linked contact')
    .option('--min-amount <n>', 'Minimum amount')
    .option('--max-amount <n>', 'Maximum amount')
    .option('--limit <n>', 'Page size (default 50)', '50')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--include-deleted', 'Include soft-deleted deals')
    .action((opts: Record<string, string | boolean>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.dealList(client, {
          stage: opts['stage'] as 'prospect' | undefined,
          company_id: opts['companyId'] as string | undefined,
          contact_id: opts['contactId'] as string | undefined,
          min_amount: opts['minAmount'] ? parseFloat(opts['minAmount'] as string) : undefined,
          max_amount: opts['maxAmount'] ? parseFloat(opts['maxAmount'] as string) : undefined,
          limit: opts['limit'] ? parseInt(opts['limit'] as string, 10) : undefined,
          cursor: opts['cursor'] as string | undefined,
          include_deleted: opts['includeDeleted'] === true,
        });
        await printOk(result.items, {
          columns: ['id', 'title', 'stage', 'amount', 'company_id', 'close_date', 'created_at'],
        });
      });
    });

  deal
    .command('update <id>')
    .description('Update a deal')
    .option('--title <title>', 'Title')
    .option('--stage <stage>', 'Stage')
    .option('--amount <n>', 'Amount')
    .option('--close-date <date>', 'Close date (YYYY-MM-DD)')
    .option('--probability <n>', 'Probability 0-100')
    .option('--owner <id>', 'Owner user ID')
    .option('--notes <text>', 'Notes summary')
    .option('--custom <json>', 'Custom fields as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((id: string, opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const patch: Record<string, unknown> = {};
        if (opts['title']) patch['title'] = opts['title'];
        if (opts['stage']) patch['stage'] = opts['stage'];
        if (opts['amount']) patch['amount'] = parseFloat(opts['amount']);
        if (opts['closeDate']) patch['close_date'] = opts['closeDate'];
        if (opts['probability']) patch['probability'] = parseInt(opts['probability'], 10);
        if (opts['owner']) patch['owner_user_id'] = opts['owner'];
        if (opts['notes']) patch['notes_summary'] = opts['notes'];
        if (opts['custom']) patch['custom_fields'] = parseJsonOpt(opts['custom']);
        await printOk(await crm.dealUpdate(client, id, patch));
      });
    });

  deal
    .command('delete <id>')
    .description('Soft-delete a deal')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.dealSoftDelete(client, id));
      });
    });

  deal
    .command('restore <id>')
    .description('Restore a soft-deleted deal')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.dealRestore(client, id));
      });
    });
}

function parseJsonOpt(val: string | undefined): Record<string, unknown> | undefined {
  if (!val) return undefined;
  try {
    const parsed: unknown = JSON.parse(val);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('--custom must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    printErr(e);
  }
}

function parseJsonArray(val: string | undefined): string[] | undefined {
  if (!val) return undefined;
  try {
    const parsed: unknown = JSON.parse(val);
    if (!Array.isArray(parsed)) throw new Error('--contacts must be a JSON array');
    return parsed as string[];
  } catch (e) {
    printErr(e);
  }
}
