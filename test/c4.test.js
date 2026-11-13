import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GENERIC_REJECT_REPLY, UNCERTAIN_REPLY, createC4Sender } from '../src/lib/c4.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-c4-'));
const c4Receive = path.join(dir, 'c4-receive.js');
const manifestPath = path.join(dir, 'c4-receive-options.json');
const U = `U${'a'.repeat(32)}`;
const ENDPOINT = `${U}|type:dm|account:default|user:${U}|replyKey:k1`;
const GROUP = `dm-default:${U}`;
const BASE_ARGS = [c4Receive, '--channel', 'line', '--endpoint', ENDPOINT, '--json', '--content', 'hi'];
const quiet = { log() {}, warn() {}, error() {} };

const rejection = (persisted) => {
  const error = Object.assign(new Error('exit 1'), { code: 1 });
  const body = { code: 'X', message: 'internal core text' };
  if (persisted !== undefined) body.persisted = persisted;
  return { error, stdout: JSON.stringify({ ok: false, error: body }) };
};
const spawnFailure = () => ({ error: Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT', syscall: 'spawn node' }), stdout: '' });

/** Fake execFile answering each call from `results` in order; records argv and options. */
function sender(results) {
  const calls = [];
  const execFileImpl = (cmd, args, options, cb) => {
    calls.push({ cmd, args, options });
    const result = results[Math.min(calls.length - 1, results.length - 1)];
    setImmediate(() => cb(result.error ?? null, result.stdout ?? '', ''));
  };
  const notices = [];
  const send = createC4Sender({ c4Receive, execFileImpl, retryDelayMs: 1, logger: quiet });
  return {
    calls,
    notices,
    run: (endpoint = ENDPOINT) => send('line', endpoint, 'hi', { onNotice: (text) => notices.push(text) })
  };
}

const setManifest = (on) => (on
  ? fs.writeFileSync(manifestPath, JSON.stringify({ options: { '--session-group': { takesValue: true } } }))
  : fs.rmSync(manifestPath, { force: true }));

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('sendToC4', () => {
  beforeEach(() => setManifest(true));

  it('older Core receives exactly the pre-change arguments, even for unmappable endpoints', async () => {
    setManifest(false);
    const s = sender([{ stdout: '{"ok":true}' }]);
    expect(await s.run()).toBe('sent');
    expect(await s.run('not a line id|type:dm')).toBe('sent');
    expect(s.calls[0].args).toEqual(BASE_ARGS);
    expect(s.calls.length).toBe(2);
  });

  it('multi-session Core receives the group, with no component timeout', async () => {
    const s = sender([{ stdout: '{"ok":true}' }]);
    expect(await s.run()).toBe('sent');
    expect(s.calls[0].args).toEqual([...BASE_ARGS, '--session-group', GROUP]);
    expect(s.calls[0].options.timeout).toBeUndefined();
    expect(s.calls[0].cmd).toBe(process.execPath);
    expect(s.notices).toEqual([]);
  });

  it('pairing notices go to the overall group', async () => {
    const s = sender([{ stdout: '{"ok":true}' }]);
    const endpoint = `admin|type:dm-pairing|account:default|user:${U}`;
    expect(await s.run(endpoint)).toBe('sent');
    expect(s.calls[0].args).not.toContain('--session-group');
  });

  it('unmappable endpoint on multi-session Core is never sent', async () => {
    const s = sender([{ stdout: '{"ok":true}' }]);
    expect(await s.run(`bad id|type:dm`)).toBe('not_stored');
    expect(s.calls).toEqual([]);
    expect(s.notices).toEqual([GENERIC_REJECT_REPLY]);
  });

  it('classifies rejections by persisted, never resends, never shows Core text', async () => {
    const cases = [
      [rejection(['D1']), 'committed', []],
      [rejection([]), 'not_stored', [GENERIC_REJECT_REPLY]],
      [rejection(null), 'uncertain', [UNCERTAIN_REPLY]],
      [rejection(undefined), 'uncertain', [UNCERTAIN_REPLY]]
    ];
    for (const [result, outcome, notices] of cases) {
      const s = sender([result]);
      expect(await s.run()).toBe(outcome);
      expect(s.calls.length).toBe(1);
      expect(s.calls[0].args).toContain('--session-group');
      expect(s.notices).toEqual(notices);
    }
  });

  it('a process that ran but failed without a result is not retried', async () => {
    const s = sender([{ error: Object.assign(new Error('killed'), { code: 3 }), stdout: '' }]);
    expect(await s.run()).toBe('uncertain');
    expect(s.calls.length).toBe(1);
    expect(s.notices).toEqual([UNCERTAIN_REPLY]);
  });

  it('a process that never started is retried once with the same group', async () => {
    const ok = sender([spawnFailure(), { stdout: '{"ok":true}' }]);
    expect(await ok.run()).toBe('sent');
    expect(ok.calls.length).toBe(2);
    expect(ok.calls[1].args).toEqual([...BASE_ARGS, '--session-group', GROUP]);
    expect(ok.notices).toEqual([]);

    // Never started twice: nothing was stored, so "try again later".
    const failed = sender([spawnFailure(), spawnFailure()]);
    expect(await failed.run()).toBe('not_stored');
    expect(failed.calls.length).toBe(2);
    expect(failed.notices).toEqual([GENERIC_REJECT_REPLY]);
  });

  it('content c4-receive cannot be started with (NUL byte) is reported, not thrown or retried', async () => {
    let calls = 0;
    const notices = [];
    const send = createC4Sender({
      c4Receive,
      execFileImpl: () => { calls += 1; throw Object.assign(new TypeError('null bytes'), { code: 'ERR_INVALID_ARG_VALUE' }); },
      retryDelayMs: 1,
      logger: quiet
    });
    expect(await send('line', ENDPOINT, 'a\0b', { onNotice: (text) => notices.push(text) })).toBe('not_stored');
    expect(calls).toBe(1);
    expect(notices).toEqual([GENERIC_REJECT_REPLY]);
  });

  it('removes NUL bytes from the content instead of failing the message', async () => {
    const calls = [];
    const send = createC4Sender({
      c4Receive,
      execFileImpl: (cmd, args, options, cb) => { calls.push(args); setImmediate(() => cb(null, '{"ok":true}', '')); },
      logger: quiet
    });
    expect(await send('line', ENDPOINT, 'a\0b')).toBe('sent');
    expect(calls[0][calls[0].indexOf('--content') + 1]).toBe('ab');
  });
});
