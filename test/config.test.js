import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAccounts, mergeConfigWithDefaults } from '../src/lib/config.js';

describe('LINE config', () => {
  it('defaults to owner DM policy and normalizes account webhook paths', () => {
    const config = mergeConfigWithDefaults({
      channelSecret: 'root-secret',
      channelAccessToken: 'root-token',
      accounts: {
        alt: {
          channelSecret: 'alt-secret',
          channelAccessToken: 'alt-token'
        }
      }
    });

    expect(config.dmPolicy).toBe('owner');
    expect(getAccounts(config)).toEqual([
      expect.objectContaining({ id: 'default', webhookPath: '/line/webhook', channelSecret: 'root-secret' }),
      expect.objectContaining({ id: 'alt', webhookPath: '/line/webhook/alt', channelSecret: 'alt-secret' })
    ]);
  });

  it('rejects duplicate webhook paths before route registration', () => {
    const config = mergeConfigWithDefaults({
      channelSecret: 'root-secret',
      accounts: {
        alt: {
          channelSecret: 'alt-secret',
          webhookPath: '/line/webhook'
        }
      }
    });

    expect(() => getAccounts(config)).toThrow(/duplicate LINE webhookPath/);
  });

  it('reads secret files but rejects symlink secret files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-config-'));
    const secretPath = path.join(dir, 'secret.txt');
    const symlinkPath = path.join(dir, 'secret-link.txt');
    fs.writeFileSync(secretPath, 'file-secret\n', { mode: 0o600 });
    fs.symlinkSync(secretPath, symlinkPath);

    const regular = mergeConfigWithDefaults({ channelSecretFile: secretPath });
    const symlink = mergeConfigWithDefaults({ channelSecretFile: symlinkPath });

    expect(regular.channelSecret).toBe('file-secret');
    expect(symlink.channelSecret).toBe('');
  });
});
