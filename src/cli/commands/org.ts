/**
 * CLI subcommands: org create|list|use|delete|current
 * Delegates to core org management functions.
 */

import type { Command } from 'commander';
import { printOk, printErr, isInteractive } from '../output.js';
import { runAction, resolveBaseClient } from '../runtime.js';
import {
  createOrg,
  listOrgs,
  useOrg,
  deleteOrg,
  resolveActiveOrg,
  initDatabase,
  getAuth,
  loadConfig,
} from '../../core/index.js';

export function registerOrgCommands(program: Command): void {
  const org = program.command('org').description('Manage CRM organisations');

  // org create <slug>
  org
    .command('create <slug>')
    .description('Create a new org and provision a Cloudflare D1 database')
    .option('--init', 'Also initialise the database schema after creation')
    .action((slug: string, opts: { init?: boolean }) => {
      runAction(async () => {
        const client = await resolveBaseClient();
        const result = await createOrg(client, slug, {
          applySchema: opts.init
            ? async (c) => { await initDatabase(c); }
            : undefined,
        });
        await printOk(result);
      });
    });

  // org list
  org
    .command('list')
    .description('List all orgs with active marker')
    .action(() => {
      runAction(async () => {
        const cfg = await loadConfig();
        const orgs = await listOrgs(cfg);
        const rows = orgs.map((o) => ({
          active: o.active ? '*' : '',
          slug: o.slug,
          database_id: o.database_id,
          database_name: o.database_name,
          created_at: o.created_at,
        }));
        await printOk(rows);
      });
    });

  // org use <slug>
  org
    .command('use <slug>')
    .description('Set the active org')
    .action((slug: string) => {
      runAction(async () => {
        await useOrg(slug);
        await printOk({ active_org: slug });
      });
    });

  // org current
  org
    .command('current')
    .description('Print the active org')
    .action(() => {
      runAction(async () => {
        const org = await resolveActiveOrg();
        await printOk(org);
      });
    });

  // org delete <slug>
  org
    .command('delete <slug>')
    .description('Remove an org from config (optionally drop the D1 database)')
    .option('--drop-database', 'Also delete the Cloudflare D1 database')
    .option('--yes', 'Skip confirmation prompt')
    .action((slug: string, opts: { dropDatabase?: boolean; yes?: boolean }) => {
      runAction(async () => {
        if (opts.dropDatabase && !opts.yes && isInteractive()) {
          // Inline readline prompt — avoids adding a dep
          const confirmed = await promptConfirm(
            `Delete org "${slug}" AND its D1 database? This is irreversible. [y/N] `,
          );
          if (!confirmed) {
            process.stdout.write('Aborted.\n');
            return;
          }
        }
        const flags = (await import('../runtime.js')).getGlobalFlags();
        const auth = await getAuth({ flagToken: flags.token, flagAccountId: flags.account });
        const { D1Client } = await import('../../core/index.js');
        const client = new D1Client({ token: auth.token, accountId: auth.account_id });
        await deleteOrg(client, slug, { dropDatabase: opts.dropDatabase });
        await printOk({ deleted: slug });
      });
    });
}

async function promptConfirm(question: string): Promise<boolean> {
  const { createInterface } = await import('node:readline');
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}
