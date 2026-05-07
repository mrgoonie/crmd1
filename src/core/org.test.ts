/**
 * Unit tests for org.ts — mocks d1-management + config functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slugify, createOrg, listOrgs, deleteOrg, resolveActiveOrg } from './org.js';
import { ErrorCode } from './errors.js';
import type { D1Client } from './d1-client.js';

// ---------------------------------------------------------------------------
// Mock config module
// ---------------------------------------------------------------------------

vi.mock('./config.js', () => ({
  loadConfig: vi.fn(),
  addOrg: vi.fn(),
  removeOrg: vi.fn(),
  getActiveOrg: vi.fn(),
  setActiveOrg: vi.fn(),
  listOrgs: vi.fn(),
}));

vi.mock('./d1-management.js', () => ({
  createDatabase: vi.fn(),
  deleteDatabase: vi.fn(),
}));

import * as configMod from './config.js';
import * as mgmtMod from './d1-management.js';

const mockLoadConfig = vi.mocked(configMod.loadConfig);
const mockAddOrg = vi.mocked(configMod.addOrg);
const mockRemoveOrg = vi.mocked(configMod.removeOrg);
const mockGetActiveOrg = vi.mocked(configMod.getActiveOrg);
const mockListOrgs = vi.mocked(configMod.listOrgs);
const mockCreateDatabase = vi.mocked(mgmtMod.createDatabase);
const mockDeleteDatabase = vi.mocked(mgmtMod.deleteDatabase);

// Minimal stub D1Client
function makeClient(): D1Client {
  return {
    withDatabase: vi.fn().mockReturnThis(),
  } as unknown as D1Client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// slugify()
// ---------------------------------------------------------------------------

describe('slugify()', () => {
  it('lowercases and replaces spaces', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('collapses multiple separators', () => {
    expect(slugify('hello---world')).toBe('hello-world');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--test--')).toBe('test');
  });

  it('truncates to 63 chars', () => {
    expect(slugify('a'.repeat(80))).toHaveLength(63);
  });

  it('throws INVALID_INPUT for empty result', () => {
    expect(() => slugify('---')).toThrow();
    expect(() => slugify('')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createOrg()
// ---------------------------------------------------------------------------

describe('createOrg()', () => {
  it('creates DB and persists to config', async () => {
    mockLoadConfig.mockResolvedValue({
      version: 1,
      orgs: {},
    });
    mockCreateDatabase.mockResolvedValue({ uuid: 'db-uuid-1', name: 'crmd1-acme' });
    mockAddOrg.mockResolvedValue(undefined);

    const client = makeClient();
    const result = await createOrg(client, 'acme');

    expect(result).toEqual({ slug: 'acme', database_id: 'db-uuid-1', database_name: 'crmd1-acme' });
    expect(mockCreateDatabase).toHaveBeenCalledWith(client, 'crmd1-acme');
    expect(mockAddOrg).toHaveBeenCalledWith('acme', 'db-uuid-1', 'crmd1-acme');
  });

  it('throws ORG_EXISTS if slug already in config', async () => {
    mockLoadConfig.mockResolvedValue({
      version: 1,
      orgs: { acme: { database_id: 'x', database_name: 'crmd1-acme', created_at: '2024-01-01' } },
    });

    const client = makeClient();
    await expect(createOrg(client, 'acme')).rejects.toMatchObject({
      code: ErrorCode.ORG_EXISTS,
    });
    expect(mockCreateDatabase).not.toHaveBeenCalled();
  });

  it('throws INVALID_INPUT for invalid slug', async () => {
    const client = makeClient();
    await expect(createOrg(client, '-invalid')).rejects.toMatchObject({
      code: ErrorCode.INVALID_INPUT,
    });
  });

  it('calls applySchema with bound client and rolls back on failure', async () => {
    mockLoadConfig.mockResolvedValue({ version: 1, orgs: {} });
    mockCreateDatabase.mockResolvedValue({ uuid: 'db-uuid-2', name: 'crmd1-rollback' });
    mockAddOrg.mockResolvedValue(undefined);
    mockDeleteDatabase.mockResolvedValue(undefined);
    mockRemoveOrg.mockResolvedValue(undefined);

    const client = makeClient();
    const applySchema = vi.fn().mockRejectedValue(new Error('schema failed'));

    await expect(createOrg(client, 'rollback', { applySchema })).rejects.toThrow('schema failed');
    expect(mockDeleteDatabase).toHaveBeenCalledWith(client, 'db-uuid-2');
    expect(mockRemoveOrg).toHaveBeenCalledWith('rollback');
  });

  it('invokes applySchema on success', async () => {
    mockLoadConfig.mockResolvedValue({ version: 1, orgs: {} });
    mockCreateDatabase.mockResolvedValue({ uuid: 'db-uuid-3', name: 'crmd1-neworg' });
    mockAddOrg.mockResolvedValue(undefined);

    const client = makeClient();
    const applySchema = vi.fn().mockResolvedValue(undefined);

    await createOrg(client, 'neworg', { applySchema });
    expect(applySchema).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// listOrgs()
// ---------------------------------------------------------------------------

describe('listOrgs()', () => {
  it('returns orgs with active flag', async () => {
    const cfg = {
      version: 1 as const,
      active_org: 'acme',
      orgs: {
        acme: { database_id: 'db1', database_name: 'crmd1-acme', created_at: '2024-01-01' },
        beta: { database_id: 'db2', database_name: 'crmd1-beta', created_at: '2024-01-02' },
      },
    };
    mockLoadConfig.mockResolvedValue(cfg);
    mockListOrgs.mockResolvedValue([
      { slug: 'acme', database_id: 'db1', database_name: 'crmd1-acme', created_at: '2024-01-01' },
      { slug: 'beta', database_id: 'db2', database_name: 'crmd1-beta', created_at: '2024-01-02' },
    ]);

    const orgs = await listOrgs(cfg);

    const acme = orgs.find((o) => o.slug === 'acme');
    const beta = orgs.find((o) => o.slug === 'beta');
    expect(acme?.active).toBe(true);
    expect(beta?.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deleteOrg()
// ---------------------------------------------------------------------------

describe('deleteOrg()', () => {
  it('removes org from config without dropping DB by default', async () => {
    mockLoadConfig.mockResolvedValue({
      version: 1,
      orgs: { acme: { database_id: 'db1', database_name: 'crmd1-acme', created_at: '2024-01-01' } },
    });
    mockRemoveOrg.mockResolvedValue(undefined);

    const client = makeClient();
    await deleteOrg(client, 'acme');

    expect(mockDeleteDatabase).not.toHaveBeenCalled();
    expect(mockRemoveOrg).toHaveBeenCalledWith('acme');
  });

  it('drops D1 database when dropDatabase=true', async () => {
    mockLoadConfig.mockResolvedValue({
      version: 1,
      orgs: { acme: { database_id: 'db1', database_name: 'crmd1-acme', created_at: '2024-01-01' } },
    });
    mockDeleteDatabase.mockResolvedValue(undefined);
    mockRemoveOrg.mockResolvedValue(undefined);

    const client = makeClient();
    await deleteOrg(client, 'acme', { dropDatabase: true });

    expect(mockDeleteDatabase).toHaveBeenCalledWith(client, 'db1');
    expect(mockRemoveOrg).toHaveBeenCalledWith('acme');
  });

  it('throws ORG_NOT_FOUND for unknown slug', async () => {
    mockLoadConfig.mockResolvedValue({ version: 1, orgs: {} });

    const client = makeClient();
    await expect(deleteOrg(client, 'unknown')).rejects.toMatchObject({
      code: ErrorCode.ORG_NOT_FOUND,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveActiveOrg()
// ---------------------------------------------------------------------------

describe('resolveActiveOrg()', () => {
  it('returns active org entry', async () => {
    const cfg = {
      version: 1 as const,
      active_org: 'acme',
      orgs: { acme: { database_id: 'db1', database_name: 'crmd1-acme', created_at: '2024-01-01' } },
    };
    mockGetActiveOrg.mockReturnValue({ slug: 'acme', database_id: 'db1', database_name: 'crmd1-acme', created_at: '2024-01-01' });

    const result = await resolveActiveOrg(cfg);
    expect(result.slug).toBe('acme');
    expect(result.database_id).toBe('db1');
  });

  it('throws when getActiveOrg throws ORG_NOT_FOUND', async () => {
    const cfg = { version: 1 as const, orgs: {} };
    const { CrmdError, ErrorCode } = await import('./errors.js');
    mockGetActiveOrg.mockImplementation(() => {
      throw new CrmdError(ErrorCode.ORG_NOT_FOUND, 'No active org');
    });

    await expect(resolveActiveOrg(cfg)).rejects.toMatchObject({
      code: ErrorCode.ORG_NOT_FOUND,
    });
  });
});
