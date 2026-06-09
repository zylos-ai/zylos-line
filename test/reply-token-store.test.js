import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReplyTokenStore } from '../src/lib/reply-token-store.js';

describe('reply token store', () => {
  it('stores reply tokens behind opaque consume-once handles', () => {
    let now = 1000;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-reply-'));
    const store = new ReplyTokenStore({ filePath: path.join(dir, 'reply.json'), now: () => now });

    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 60_000
    });

    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(key).not.toContain('raw-reply-token');
    expect(store.consume(key)).toEqual(expect.objectContaining({ replyToken: 'raw-reply-token', consumed: true }));
    expect(store.consume(key)).toBeNull();
  });

  it('expires handles', () => {
    let now = 1000;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-reply-'));
    const store = new ReplyTokenStore({ filePath: path.join(dir, 'reply.json'), now: () => now });

    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 10
    });
    now = 1011;

    expect(store.consume(key)).toBeNull();
  });

  it('uses process-local state as primary and persists mutations to disk', () => {
    let now = 1000;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-reply-'));
    const filePath = path.join(dir, 'reply.json');
    const store = new ReplyTokenStore({ filePath, now: () => now });

    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 60_000
    });
    fs.writeFileSync(filePath, '{}');

    expect(store.consume(key)).toEqual(expect.objectContaining({ replyToken: 'raw-reply-token', consumed: true }));
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))[key].consumed).toBe(true);
  });
});
