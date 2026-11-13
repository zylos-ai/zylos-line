import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildEndpoint } from '../src/lib/format.js';
import { accountIdProblem, isValidSessionGroup, sessionGroupFromEndpoint } from '../src/lib/session-group.js';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/session-group.js');
const U = `U${'a'.repeat(32)}`;
const C = `C${'b'.repeat(32)}`;
const R = `R${'c'.repeat(32)}`;

const MAPPED = [
  [buildEndpoint(U, { type: 'dm', accountId: 'default', userId: U, replyKey: 'k1' }), `dm-default:${U}`],
  [buildEndpoint(C, { type: 'group', accountId: 'default', userId: U, replyKey: 'k2' }), `group-default:${C}`],
  [buildEndpoint(R, { type: 'room', accountId: 'shop_2', userId: U }), `room-shop_2:${R}`],
  // a second account talking to the same user is a separate conversation
  [buildEndpoint(U, { type: 'dm', accountId: 'alt' }), `dm-alt:${U}`],
  [buildEndpoint(U, { type: 'dm', accountId: 'my.shop' }), `dm-my.shop:${U}`],
  // per-message parts (user, replyKey) never affect the group
  [buildEndpoint(C, { type: 'group', accountId: 'default', userId: 'Uother', replyKey: 'other' }), `group-default:${C}`],
  // shorthand accepted by scripts/send.js maps like the inbound endpoint
  [U, `dm-default:${U}`],
  [`${U}|account:default`, `dm-default:${U}`],
  [`${C}|type:group`, `group-default:${C}`],
  [`${R}|account:shop_2`, `room-shop_2:${R}`],
];

const INVALID = [
  '',
  `X${'a'.repeat(32)}|account:default`,    // no type and no U/C/R prefix
  `${U}|type:unknown|account:default`,
  `${U}|type:dm|account:a:b`,              // ':' in account breaks reversibility
  `${U}|type:dm|account:`,
  `|type:dm|account:default`,
  `U-1|type:dm|account:default`,
  `${U}|type:dm|account:${'x'.repeat(60)}`, // over 95 characters, never truncated
];

describe('session groups', () => {
  it('maps each conversation type to its session group', () => {
    for (const [endpoint, group] of MAPPED) {
      expect(sessionGroupFromEndpoint(endpoint), endpoint).toBe(group);
      expect(isValidSessionGroup(group), group).toBe(true);
    }
  });

  it('is reversible to account and conversation id', () => {
    for (const [endpoint, group] of MAPPED.slice(0, 6)) {
      const [prefix, rest] = [group.slice(0, group.indexOf('-')), group.slice(group.indexOf('-') + 1)];
      const [account, targetId] = rest.split(':');
      expect(endpoint.startsWith(`${targetId}|type:${prefix}|account:${account}`), endpoint).toBe(true);
    }
  });

  it('sends the pairing notice to the overall group', () => {
    expect(sessionGroupFromEndpoint(`admin|type:dm-pairing|account:default|user:${U}`)).toBe('');
  });

  it('throws for endpoints it cannot map instead of using the overall group', () => {
    for (const endpoint of [...INVALID, null, undefined]) {
      expect(() => sessionGroupFromEndpoint(endpoint), String(endpoint)).toThrow();
    }
  });

  it('isValidSessionGroup matches Core syntax', () => {
    for (const name of ['dm-a:b', 'x'.repeat(95)]) expect(isValidSessionGroup(name)).toBe(true);
    for (const name of ['', '-a', 'a@b', 'a b', 'x'.repeat(96), null, 42]) expect(isValidSessionGroup(name)).toBe(false);
  });

  it('CLI prints the same group the receiver sends', () => {
    for (const [endpoint, group] of MAPPED) {
      expect(execFileSync(process.execPath, [script, endpoint], { encoding: 'utf8' })).toBe(`${group}\n`);
    }
    expect(execFileSync(process.execPath, [script, `admin|type:dm-pairing|account:default|user:${U}`], { encoding: 'utf8' })).toBe('');
  });

  it('CLI failure exits 1 with nothing on stdout', () => {
    for (const args of [[], ["a", "b"], [""], ["bad id|type:dm"]]) {
      let error;
      try {
        execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' });
      } catch (err) {
        error = err;
      }
      expect(error?.status, JSON.stringify(args)).toBe(1);
      expect(error.stdout.toString()).toBe('');
      expect(error.stderr.toString()).not.toBe('');
    }
  });

  it('reports account ids that cannot be mapped, before any message arrives', () => {
    for (const id of ['default', 'shop_2', 'my.shop']) expect(accountIdProblem(id), id).toBeNull();
    for (const id of ['shop 1', '店铺', 'a:b', '_x', 'x'.repeat(58)]) expect(accountIdProblem(id), id).toBeTypeOf('string');
  });
});
