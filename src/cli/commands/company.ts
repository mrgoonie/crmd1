/**
 * CLI subcommands: company create|get|list|update|delete|restore
 */

import type { Command } from 'commander';
import { printOk, printErr } from '../output.js';
import { runAction, resolveAuthAndOrg } from '../runtime.js';
import { crm } from '../../core/index.js';

export function registerCompanyCommands(program: Command): void {
  const company = program.command('company').description('Manage companies');

  company
    .command('create')
    .description('Create a new company')
    .requiredOption('--name <name>', 'Company name')
    .option('--domain <domain>', 'Company domain (e.g. acme.com)')
    .option('--industry <industry>', 'Industry')
    .option('--employee-count <n>', 'Employee count')
    .option('--status <status>', 'Status: active|inactive|prospect|churned')
    .option('--notes <text>', 'Notes summary')
    .option('--custom <json>', 'Custom fields as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.companyCreate(
          client,
          {
            name: opts['name'] ?? '',
            domain: opts['domain'],
            industry: opts['industry'],
            employee_count: opts['employeeCount'] ? parseInt(opts['employeeCount'], 10) : undefined,
            status: opts['status'] as 'active' | undefined,
            notes_summary: opts['notes'],
            custom_fields: parseJsonOpt(opts['custom']),
          },
          { idempotency_key: opts['idempotencyKey'] },
        );
        await printOk(result);
      });
    });

  company
    .command('get <id>')
    .description('Get a company by ID')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.companyGet(client, id));
      });
    });

  company
    .command('list')
    .description('List companies')
    .option('--domain <domain>', 'Filter by domain')
    .option('--status <status>', 'Filter by status')
    .option('--q <query>', 'Search query')
    .option('--limit <n>', 'Page size (default 50)', '50')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--include-deleted', 'Include soft-deleted companies')
    .action((opts: Record<string, string | boolean>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.companyList(client, {
          domain: opts['domain'] as string | undefined,
          status: opts['status'] as 'active' | undefined,
          q: opts['q'] as string | undefined,
          limit: opts['limit'] ? parseInt(opts['limit'] as string, 10) : undefined,
          cursor: opts['cursor'] as string | undefined,
          include_deleted: opts['includeDeleted'] === true,
        });
        await printOk(result.items, {
          columns: ['id', 'name', 'domain', 'industry', 'status', 'created_at'],
        });
      });
    });

  company
    .command('update <id>')
    .description('Update a company')
    .option('--name <name>', 'Company name')
    .option('--domain <domain>', 'Domain')
    .option('--industry <industry>', 'Industry')
    .option('--employee-count <n>', 'Employee count')
    .option('--status <status>', 'Status')
    .option('--notes <text>', 'Notes summary')
    .option('--custom <json>', 'Custom fields as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((id: string, opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const patch: Record<string, unknown> = {};
        if (opts['name']) patch['name'] = opts['name'];
        if (opts['domain']) patch['domain'] = opts['domain'];
        if (opts['industry']) patch['industry'] = opts['industry'];
        if (opts['employeeCount']) patch['employee_count'] = parseInt(opts['employeeCount'], 10);
        if (opts['status']) patch['status'] = opts['status'];
        if (opts['notes']) patch['notes_summary'] = opts['notes'];
        if (opts['custom']) patch['custom_fields'] = parseJsonOpt(opts['custom']);
        await printOk(await crm.companyUpdate(client, id, patch));
      });
    });

  company
    .command('delete <id>')
    .description('Soft-delete a company')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.companySoftDelete(client, id));
      });
    });

  company
    .command('restore <id>')
    .description('Restore a soft-deleted company')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.companyRestore(client, id));
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
