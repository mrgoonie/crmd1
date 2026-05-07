/**
 * CLI subcommands: task create|get|list|update|complete|delete|restore
 */

import type { Command } from 'commander';
import { printOk, printErr } from '../output.js';
import { runAction, resolveAuthAndOrg } from '../runtime.js';
import { crm } from '../../core/index.js';

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('Manage tasks');

  task
    .command('create')
    .description('Create a new task')
    .requiredOption('--title <title>', 'Task title')
    .requiredOption('--due-date <date>', 'Due date (YYYY-MM-DD)')
    .option('--description <text>', 'Task description')
    .option('--entity-type <type>', 'Linked entity type: contact|company|deal')
    .option('--entity-id <id>', 'Linked entity ID')
    .option('--assigned-to <user>', 'Assignee user ID')
    .option('--status <status>', 'Status: open|in_progress|completed|cancelled')
    .option('--priority <priority>', 'Priority: low|medium|high|urgent')
    .option('--custom <json>', 'Custom fields as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.taskCreate(
          client,
          {
            title: opts['title'] ?? '',
            due_date: opts['dueDate'] ?? '',
            description: opts['description'],
            entity_type: opts['entityType'] as 'contact' | undefined,
            entity_id: opts['entityId'],
            assigned_to: opts['assignedTo'],
            status: opts['status'] as 'open' | undefined,
            priority: opts['priority'] as 'low' | undefined,
            custom_fields: parseJsonOpt(opts['custom']),
          },
          { idempotency_key: opts['idempotencyKey'] },
        );
        await printOk(result);
      });
    });

  task
    .command('get <id>')
    .description('Get a task by ID')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.taskGet(client, id));
      });
    });

  task
    .command('list')
    .description('List tasks')
    .option('--status <status>', 'Filter by status')
    .option('--assignee <user>', 'Filter by assignee')
    .option('--entity-type <type>', 'Filter by entity type')
    .option('--entity-id <id>', 'Filter by entity ID')
    .option('--due-before <date>', 'Due before date (YYYY-MM-DD)')
    .option('--due-after <date>', 'Due after date (YYYY-MM-DD)')
    .option('--limit <n>', 'Page size (default 50)', '50')
    .option('--cursor <cursor>', 'Pagination cursor')
    .option('--include-deleted', 'Include soft-deleted tasks')
    .action((opts: Record<string, string | boolean>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const result = await crm.taskList(client, {
          status: opts['status'] as 'open' | undefined,
          assignee: opts['assignee'] as string | undefined,
          entity_type: opts['entityType'] as 'contact' | undefined,
          entity_id: opts['entityId'] as string | undefined,
          due_before: opts['dueBefore'] as string | undefined,
          due_after: opts['dueAfter'] as string | undefined,
          limit: opts['limit'] ? parseInt(opts['limit'] as string, 10) : undefined,
          cursor: opts['cursor'] as string | undefined,
          include_deleted: opts['includeDeleted'] === true,
        });
        await printOk(result.items, {
          columns: ['id', 'title', 'status', 'priority', 'assigned_to', 'due_date', 'created_at'],
        });
      });
    });

  task
    .command('update <id>')
    .description('Update a task')
    .option('--title <title>', 'Title')
    .option('--description <text>', 'Description')
    .option('--due-date <date>', 'Due date (YYYY-MM-DD)')
    .option('--status <status>', 'Status')
    .option('--priority <priority>', 'Priority')
    .option('--assigned-to <user>', 'Assignee')
    .option('--entity-type <type>', 'Entity type')
    .option('--entity-id <id>', 'Entity ID')
    .option('--custom <json>', 'Custom fields as JSON object')
    .option('--idempotency-key <key>', 'Idempotency key')
    .action((id: string, opts: Record<string, string>) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        const patch: Record<string, unknown> = {};
        if (opts['title']) patch['title'] = opts['title'];
        if (opts['description']) patch['description'] = opts['description'];
        if (opts['dueDate']) patch['due_date'] = opts['dueDate'];
        if (opts['status']) patch['status'] = opts['status'];
        if (opts['priority']) patch['priority'] = opts['priority'];
        if (opts['assignedTo']) patch['assigned_to'] = opts['assignedTo'];
        if (opts['entityType']) patch['entity_type'] = opts['entityType'];
        if (opts['entityId']) patch['entity_id'] = opts['entityId'];
        if (opts['custom']) patch['custom_fields'] = parseJsonOpt(opts['custom']);
        await printOk(await crm.taskUpdate(client, id, patch));
      });
    });

  task
    .command('complete <id>')
    .description('Mark a task as completed')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.taskComplete(client, id));
      });
    });

  task
    .command('delete <id>')
    .description('Soft-delete a task')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.taskSoftDelete(client, id));
      });
    });

  task
    .command('restore <id>')
    .description('Restore a soft-deleted task')
    .action((id: string) => {
      runAction(async () => {
        const { client } = await resolveAuthAndOrg();
        await printOk(await crm.taskRestore(client, id));
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
