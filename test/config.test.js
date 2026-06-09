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
});
