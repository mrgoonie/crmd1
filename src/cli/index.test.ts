/**
 * CLI smoke tests: constructs the Program and asserts --help contains all
 * expected subcommands. Does not spawn the binary or make network calls.
 */

import { describe, it, expect } from 'vitest';
import { buildProgram } from './index.js';

describe('CLI program structure', () => {
  it('includes all top-level subcommands in help output', () => {
    const program = buildProgram();
    // exitOverride prevents process.exit on --help
    program.exitOverride();

    let helpText = '';
    try {
      program.parse(['node', 'crmd1', '--help']);
    } catch {
      // commander throws with exitCode 0 on --help when exitOverride is set
    }
    helpText = program.helpInformation();

    const expectedCommands = ['org', 'db', 'contact', 'company', 'deal', 'activity', 'task', 'search'];
    for (const cmd of expectedCommands) {
      expect(helpText, `expected "${cmd}" in help`).toContain(cmd);
    }
  });

  it('org subcommand has expected sub-subcommands', () => {
    const program = buildProgram();
    program.exitOverride();

    const orgCmd = program.commands.find((c) => c.name() === 'org');
    expect(orgCmd).toBeDefined();

    const subNames = orgCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('create');
    expect(subNames).toContain('list');
    expect(subNames).toContain('use');
    expect(subNames).toContain('delete');
    expect(subNames).toContain('current');
  });

  it('db subcommand has init, version, query', () => {
    const program = buildProgram();
    const dbCmd = program.commands.find((c) => c.name() === 'db');
    expect(dbCmd).toBeDefined();
    const subNames = dbCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('init');
    expect(subNames).toContain('version');
    expect(subNames).toContain('query');
  });

  it('contact subcommand has CRUD + restore', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'contact');
    expect(cmd).toBeDefined();
    const subNames = cmd!.commands.map((c) => c.name());
    expect(subNames).toContain('create');
    expect(subNames).toContain('get');
    expect(subNames).toContain('list');
    expect(subNames).toContain('update');
    expect(subNames).toContain('delete');
    expect(subNames).toContain('restore');
  });

  it('activity subcommand has log|get|list|delete (no update)', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'activity');
    expect(cmd).toBeDefined();
    const subNames = cmd!.commands.map((c) => c.name());
    expect(subNames).toContain('log');
    expect(subNames).toContain('get');
    expect(subNames).toContain('list');
    expect(subNames).toContain('delete');
    expect(subNames).not.toContain('update');
  });

  it('task subcommand has complete command', () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === 'task');
    expect(cmd).toBeDefined();
    const subNames = cmd!.commands.map((c) => c.name());
    expect(subNames).toContain('complete');
    expect(subNames).toContain('restore');
  });

  it('search is a top-level command', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('search');
  });

  it('has --json global flag', () => {
    const program = buildProgram();
    const jsonOpt = program.options.find((o) => o.long === '--json');
    expect(jsonOpt).toBeDefined();
  });

  it('has --token and --account global flags', () => {
    const program = buildProgram();
    const opts = program.options.map((o) => o.long);
    expect(opts).toContain('--token');
    expect(opts).toContain('--account');
  });
});
