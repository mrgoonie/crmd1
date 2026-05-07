/**
 * CLI subcommands: contact create|get|list|update|delete|restore
 */

import type { Command } from 'commander';
import { printOk, printErr } from '../output.js';
import { runAction, resolveAuthAndOrg } from '../runtime.js';
import { crm } from '../../core/index.js';

export function registerContactCommands(program: Command): void {
  const contact = program.command('contact').description('Manage contacts');

  contact
    .command('create')
    .description('Create a new contact')
    .requiredOption('--email <email>', 'Contact email')
    .requiredOption('--first-name <name>', 'First name')
    .requiredOption('--last-name <name>', 'Last name')
    .option('--phone <phone>', 'Phone number')
    .option('--job-title <title>', 'Job title')
    .option('--company-id <id>', 'Company UUID')
    .option('--status <status>', 'Status: prospect|active|inactive|churned')
    .option('--notes <text>', 'Notes summary')
    .option('--custom <json>', 'Custom fields as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const custom = parseJsonOpt(opts['custom']);
        const result = await crm.contactCreate(
          client,
          {
            email: opts['email'] ?? '',
            first_name: opts['firstName'] ?? '',
            last_name: opts['lastName'] ?? '',
            phone: opts['phone'],
            job_title: opts['jobTitle'],
            company_id: opts['companyId'],
            status: opts['status'] as 'prospect' | undefined,
            notes_summary: opts['notes'],
            custom_fields: custom,
          },
          { idempotency_key: opts['idempotencyKey'] },
        );
        await printOk(result);
      });
    });

  contact
    .command('get <id>')
    .description('Get a contact by ID')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.contactGet(client, id);
        await printOk(result);
      });
    });

  contact
    .command('list')
    .description('List contacts')
    .option('--company-id <id>', 'Filter by company ID')
    .option('--q <query>', 'Search query')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Page size (default 50)', '50')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--include-deleted', 'Include soft-deleted contacts')
    .action((opts: Record<string, string | boolean>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.contactList(client, {
          company_id: opts['companyId'] as string | undefined,
          q: opts['q'] as string | undefined,
          status: opts['status'] as 'prospect' | undefined,
          limit: opts['limit'] ? parseInt(opts['limit'] as string, 10) : undefined,
          cursor: opts['cursor'] as string | undefined,
          include_deleted: opts['includeDeleted'] === true,
        });
        await printOk(result.items, {
          columns: ['id', 'email', 'first_name', 'last_name', 'status', 'company_id', 'created_at'],
        });
      });
    });

  contact
    .command('update <id>')
    .description('Update a contact')
    .option('--email <email>', 'Email')
    .option('--first-name <name>', 'First name')
    .option('--last-name <name>', 'Last name')
    .option('--phone <phone>', 'Phone')
    .option('--job-title <title>', 'Job title')
    .option('--company-id <id>', 'Company UUID')
    .option('--status <status>', 'Status')
    .option('--notes <text>', 'Notes summary')
    .option('--custom <json>', 'Custom fields as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((id: string, opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const patch: Record<string, unknown> = {};
        if (opts['email']) patch['email'] = opts['email'];
        if (opts['firstName']) patch['first_name'] = opts['firstName'];
        if (opts['lastName']) patch['last_name'] = opts['lastName'];
        if (opts['phone']) patch['phone'] = opts['phone'];
        if (opts['jobTitle']) patch['job_title'] = opts['jobTitle'];
        if (opts['companyId']) patch['company_id'] = opts['companyId'];
        if (opts['status']) patch['status'] = opts['status'];
        if (opts['notes']) patch['notes_summary'] = opts['notes'];
        if (opts['custom']) patch['custom_fields'] = parseJsonOpt(opts['custom']);
        const result = await crm.contactUpdate(client, id, patch);
        await printOk(result);
      });
    });

  contact
    .command('delete <id>')
    .description('Soft-delete a contact')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.contactSoftDelete(client, id);
        await printOk(result);
      });
    });

  contact
    .command('restore <id>')
    .description('Restore a soft-deleted contact')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.contactRestore(client, id);
        await printOk(result);
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
