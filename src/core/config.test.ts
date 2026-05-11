import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';

// We need to control configDir() output — patch env before importing module
// Use vi.stubEnv + dynamic import pattern

describe('configDir()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns APPDATA/crmd1 on Windows', async () => {
    vi.stubEnv('APPDATA', 'C:\\Users\\test\\AppData\\Roaming');
    // Temporarily fake platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const { configDir } = await import('./config.js');
    const dir = configDir();
    expect(dir).toBe(join('C:\\Users\\test\\AppData\\Roaming', 'crmd1'));

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('uses XDG_CONFIG_HOME when set on non-Windows', async () => {
    // Use OS-appropriate separator for the expected path
    const xdgBase = ['', 'custom', 'config'].join(sep);
    vi.stubEnv('XDG_CONFIG_HOME', xdgBase);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const { configDir } = await import('./config.js');
    const dir = configDir();
    expect(dir).toBe(join(xdgBase, 'crmd1'));

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});

describe('loadConfig / saveConfig round-trip', () => {
  let tmpDir: string;
  // Save original platform so we can restore it
  const originalPlatform = process.platform;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `crmd1-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    vi.restoreAllMocks();
    // Redirect config to tmpDir by overriding APPDATA on Windows (or XDG on POSIX).
    // configDir() reads these env vars at call-time, so loadConfig/saveConfig both
    // use the isolated tmp location — no real config file is touched.
    if (process.platform === 'win32') {
      vi.stubEnv('APPDATA', tmpDir);
    } else {
      vi.stubEnv('XDG_CONFIG_HOME', tmpDir);
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when config file does not exist', async () => {
    // tmpDir has no config.json — loadConfig should return defaults
    const mod = await import('./config.js');
    const c = await mod.loadConfig();
    expect(c.version).toBe(1);
    expect(c.orgs).toEqual({});
    expect(c.active_org).toBeUndefined();
  });

  it('round-trips config through save and load', async () => {
    const mod = await import('./config.js');

    const cfg = {
      version: 1 as const,
      account_id: 'acc123',
      active_org: 'acme',
      orgs: {
        acme: {
          database_id: 'db-uuid',
          database_name: 'crmd1-acme',
          created_at: '2024-01-01T00:00:00.000Z',
        },
      },
    };

    await mod.saveConfig(cfg);
    const loaded = await mod.loadConfig();

    expect(loaded.version).toBe(1);
    expect(loaded.account_id).toBe('acc123');
    expect(loaded.active_org).toBe('acme');
    expect(loaded.orgs['acme']?.database_id).toBe('db-uuid');
  });
});

describe('getAuth()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves token from env var', async () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'env-token-123');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'env-account-123');

    const mod = await import('./config.js');
    vi.spyOn(mod, 'loadConfig').mockResolvedValue({ version: 1, orgs: {} });

    const auth = await mod.getAuth();
    expect(auth.token).toBe('env-token-123');
    expect(auth.account_id).toBe('env-account-123');
  });

  it('flag token takes precedence over env', async () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'env-token');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'env-account');

    const mod = await import('./config.js');
    vi.spyOn(mod, 'loadConfig').mockResolvedValue({ version: 1, orgs: {} });

    const auth = await mod.getAuth({ flagToken: 'flag-token', flagAccountId: 'flag-account' });
    expect(auth.token).toBe('flag-token');
    expect(auth.account_id).toBe('flag-account');
  });

  it('throws AUTH_MISSING when no token available', async () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'some-account');

    const mod = await import('./config.js');
    vi.spyOn(mod, 'loadConfig').mockResolvedValue({ version: 1, orgs: {} });

    await expect(mod.getAuth()).rejects.toMatchObject({ code: 'AUTH_MISSING' });
  });
});

describe('getActiveOrg()', () => {
  it('returns active org entry', async () => {
    const { getActiveOrg } = await import('./config.js');
    const cfg = {
      version: 1 as const,
      active_org: 'acme',
      orgs: {
        acme: { database_id: 'db1', database_name: 'crmd1-acme', created_at: '2024-01-01T00:00:00.000Z' },
      },
    };
    const result = getActiveOrg(cfg);
    expect(result.slug).toBe('acme');
    expect(result.database_id).toBe('db1');
  });

  it('throws ORG_NOT_FOUND when active_org not set', async () => {
    const { getActiveOrg } = await import('./config.js');
    expect(() => getActiveOrg({ version: 1, orgs: {} })).toThrow(
      expect.objectContaining({ code: 'ORG_NOT_FOUND' }),
    );
  });

  it('throws ORG_NOT_FOUND when active_org not in orgs map', async () => {
    const { getActiveOrg } = await import('./config.js');
    expect(() =>
      getActiveOrg({ version: 1, active_org: 'missing', orgs: {} }),
    ).toThrow(expect.objectContaining({ code: 'ORG_NOT_FOUND' }));
  });
});
