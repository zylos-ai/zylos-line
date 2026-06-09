import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideInboundAccess } from '../src/lib/access.js';
import { runAdminCommand, saveAdminConfig } from '../src/lib/admin.js';
import { savePairingState } from '../src/lib/dm-pairing.js';

function tempPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-admin-'));
  return {
    configPath: path.join(dir, 'config.json'),
    pairingPath: path.join(dir, 'pairing.json')
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    channelAccessToken: 'secret-token',
    channelSecret: 'secret-value',
    owner: { bound: true, userId: 'Uowner', name: 'Owner' },
    dmPolicy: 'owner',
    dmAllowFrom: [],
    groupPolicy: 'allowlist',
    groups: {},
    accounts: {
      alt: {
        channelAccessToken: 'alt-secret-token',
        channelSecret: 'alt-secret-value',
        webhookPath: '/line/webhook/alt'
      }
    },
    mediaMaxMb: 10,
    requestMaxBytes: '1mb',
    ...overrides
  };
}

function event(source) {
  return {
    source,
    message: { type: 'text', text: 'hello' }
  };
}

describe('admin access CLI logic', () => {
  it('adds DM allowlist entries that the runtime access path actually allows', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig({ dmPolicy: 'allowlist' }), configPath);

    runAdminCommand(['dm-allow', 'add', ' Uguest '], { configPath, pairingPath });
    const config = readJson(configPath);

    expect(config.dmAllowFrom).toEqual(['Uguest']);
    expect(decideInboundAccess({
      config,
      event: event({ type: 'user', userId: 'Uguest' })
    })).toEqual({ allowed: true, reason: 'dm-allowlist' });
  });

  it('does not silently turn last DM allowlist removal into allow-all', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig({ dmPolicy: 'allowlist', dmAllowFrom: ['Uguest'] }), configPath);

    expect(() => runAdminCommand(['dm-allow', 'remove', 'Uguest'], { configPath, pairingPath }))
      .toThrow(/refusing to empty dmAllowFrom/);
    expect(readJson(configPath).dmAllowFrom).toEqual(['Uguest']);

    runAdminCommand(['dm-allow', 'remove', 'Uguest', '--confirm-empty'], { configPath, pairingPath });
    expect(readJson(configPath).dmAllowFrom).toEqual([]);
  });

  it('does not silently turn last group allowFrom removal into allow-all', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig({
      groups: {
        Cgroup: { allowFrom: ['Uguest'] }
      }
    }), configPath);

    expect(() => runAdminCommand(['group', 'remove-user', 'Cgroup', 'Uguest'], { configPath, pairingPath }))
      .toThrow(/refusing to empty group allowFrom/);
    expect(readJson(configPath).groups.Cgroup.allowFrom).toEqual(['Uguest']);

    runAdminCommand(['group', 'remove-user', 'Cgroup', 'Uguest', '--confirm-empty'], { configPath, pairingPath });
    expect(readJson(configPath).groups.Cgroup.allowFrom).toEqual([]);
  });

  it('preserves empty group allowFrom semantics only when explicitly requested', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig(), configPath);

    expect(() => runAdminCommand(['group', 'add', 'Cgroup'], { configPath, pairingPath }))
      .toThrow(/requires --allow-all/);
    runAdminCommand(['group', 'add', 'Cgroup', '--allow-all'], { configPath, pairingPath });

    const config = readJson(configPath);
    expect(config.groups.Cgroup.allowFrom).toEqual([]);
    expect(decideInboundAccess({
      config,
      event: event({ type: 'group', groupId: 'Cgroup', userId: 'Uany' })
    })).toEqual({ allowed: true, reason: 'group-configured' });
  });

  it('rejects prototype-pollution keys and non-LINE IDs before mutation', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig(), configPath);
    const before = fs.readFileSync(configPath, 'utf8');

    expect(() => runAdminCommand(['dm-allow', 'add', '__proto__'], { configPath, pairingPath }))
      .toThrow(/invalid LINE user ID/);
    expect(() => runAdminCommand(['group', 'add', 'constructor', '--allow-all'], { configPath, pairingPath }))
      .toThrow(/invalid LINE group\/room ID/);
    expect(() => runAdminCommand(['group', 'add', 'Glegacy', '--allow-all'], { configPath, pairingPath }))
      .toThrow(/invalid LINE group\/room ID/);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
    expect({}.polluted).toBeUndefined();
  });

  it('validates policies before writing and preserves unrelated config fields', () => {
    const { configPath, pairingPath } = tempPaths();
    const original = baseConfig({
      dmPolicy: 'owner',
      accounts: {
        alt: {
          channelAccessToken: 'alt-secret-token',
          channelSecret: 'alt-secret-value',
          webhookPath: '/line/webhook/alt',
          custom: { keep: true }
        }
      }
    });
    saveAdminConfig(original, configPath);

    expect(() => runAdminCommand(['policy', 'dm', 'surprise'], { configPath, pairingPath }))
      .toThrow(/invalid DM policy/);
    expect(readJson(configPath)).toEqual(original);

    runAdminCommand(['policy', 'dm', 'pairing'], { configPath, pairingPath });
    expect(readJson(configPath)).toEqual({
      ...original,
      dmPolicy: 'pairing'
    });
  });

  it('requires --force before rebinding an existing owner', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig(), configPath);

    expect(() => runAdminCommand(['owner', 'bind', 'Uother'], { configPath, pairingPath }))
      .toThrow(/owner already bound/);
    expect(readJson(configPath).owner.userId).toBe('Uowner');

    runAdminCommand(['owner', 'bind', 'Uother', 'Other', '--force'], { configPath, pairingPath });
    expect(readJson(configPath).owner).toEqual({ bound: true, userId: 'Uother', name: 'Other' });
  });

  it('redacts status output instead of exposing secrets', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig(), configPath);

    const status = runAdminCommand(['status'], { configPath, pairingPath });
    const serialized = JSON.stringify(status);

    expect(status.hasDefaultCredentials).toBe(true);
    expect(status.accounts.alt.hasChannelAccessToken).toBe(true);
    expect(status.accounts.alt.hasChannelSecret).toBe(true);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('alt-secret');
  });

  it('approves only existing pending pairings and adds allowlist idempotently', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig({ dmPolicy: 'pairing', dmAllowFrom: [] }), configPath);
    savePairingState({
      pending: {
        Uguest: { userId: 'Uguest', userName: 'Guest', conversationId: 'Uguest' }
      },
      denied: {}
    }, pairingPath);

    expect(() => runAdminCommand(['pairing', 'approve', 'Uforged'], { configPath, pairingPath }))
      .toThrow(/not found/);
    expect(readJson(configPath).dmAllowFrom).toEqual([]);

    runAdminCommand(['pairing', 'approve', 'Uguest'], { configPath, pairingPath });
    expect(readJson(configPath).dmAllowFrom).toEqual(['Uguest']);
    expect(readJson(pairingPath).pending).toEqual({});
    expect(decideInboundAccess({
      config: readJson(configPath),
      event: event({ type: 'user', userId: 'Uguest' }),
      loadPairing: () => readJson(pairingPath)
    })).toEqual({ allowed: true, reason: 'dm-pairing-approved' });

    savePairingState({
      pending: {
        Uguest: { userId: 'Uguest', userName: 'Guest', conversationId: 'Uguest' }
      },
      denied: {}
    }, pairingPath);
    runAdminCommand(['pairing', 'approve', 'Uguest'], { configPath, pairingPath });
    expect(readJson(configPath).dmAllowFrom).toEqual(['Uguest']);
  });

  it('denies pending pairings without allowing them', () => {
    const { configPath, pairingPath } = tempPaths();
    saveAdminConfig(baseConfig({ dmPolicy: 'pairing', dmAllowFrom: [] }), configPath);
    savePairingState({
      pending: {
        Uguest: { userId: 'Uguest', userName: 'Guest', conversationId: 'Uguest' }
      },
      denied: {}
    }, pairingPath);

    runAdminCommand(['pairing', 'deny', 'Uguest'], { configPath, pairingPath });

    expect(readJson(configPath).dmAllowFrom).toEqual([]);
    expect(readJson(pairingPath).pending).toEqual({});
    expect(readJson(pairingPath).denied.Uguest).toEqual(expect.objectContaining({ userId: 'Uguest' }));
    expect(decideInboundAccess({
      config: readJson(configPath),
      event: event({ type: 'user', userId: 'Uguest' }),
      loadPairing: () => readJson(pairingPath)
    })).toEqual({ allowed: false, reason: 'dm-pairing-denied' });
  });
});
