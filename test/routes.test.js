import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/routes.js';
import { mergeConfigWithDefaults, setConfigForTests } from '../src/lib/config.js';
import { computeLineSignature } from '../src/lib/signature.js';
import { EventDedupeStore } from '../src/lib/event-dedupe.js';
import { ReplyTokenStore } from '../src/lib/reply-token-store.js';

function tempFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'line-route-')), name);
}

function signedPost(app, pathName, body, secret) {
  const rawText = JSON.stringify(body);
  const raw = Buffer.from(rawText);
  return request(app)
    .post(pathName)
    .set('Content-Type', 'application/json')
    .set('X-Line-Signature', computeLineSignature(raw, secret))
    .send(rawText);
}

describe('LINE webhook routes', () => {
  let sent;
  let app;

  beforeEach(() => {
    sent = [];
    setConfigForTests(mergeConfigWithDefaults({
      channelSecret: 'root-secret',
      channelAccessToken: 'root-token',
      accounts: {
        alt: {
          channelSecret: 'alt-secret',
          channelAccessToken: 'alt-token',
          webhookPath: '/line/webhook/alt'
        }
      },
      replyTokenTtlMs: 60_000,
      webhookDedupTtlMs: 60_000
    }));
    app = createApp({
      internalToken: 'internal',
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore: new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 }),
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 })
    });
  });

  it('treats GET webhook as health-only, not LINE verification', async () => {
    const res = await request(app).get('/line/webhook').expect(200);

    expect(res.body.note).toMatch(/signed POST/);
  });

  it('selects account by path before raw-body HMAC verification', async () => {
    const body = { destination: 'ignored', events: [] };
    await signedPost(app, '/line/webhook/alt', body, 'root-secret').expect(401);
    await signedPost(app, '/line/webhook/alt', body, 'alt-secret').expect(200);
  });

  it('verifies raw body before parsing and rejects invalid signatures', async () => {
    const raw = Buffer.from('{"events":[]} ');
    await request(app)
      .post('/line/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Line-Signature', computeLineSignature(Buffer.from('{"events":[]}'), 'root-secret'))
      .send(raw.toString('utf8'))
      .expect(401);
  });

  it('verifies signature before JSON parsing', async () => {
    const rawText = '{"events":[';
    await request(app)
      .post('/line/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Line-Signature', computeLineSignature(Buffer.from(rawText), 'root-secret'))
      .send(rawText)
      .expect(400);
  });

  it('dedupes webhookEventId and sends replyKey handle without raw reply token', async () => {
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-1',
        replyToken: 'raw-reply-token',
        source: { type: 'user', userId: 'U123' },
        message: { type: 'text', text: 'hello <line>' }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);
    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('line');
    expect(sent[0].endpoint).toContain('U123|type:dm|account:default|user:U123|replyKey:');
    expect(sent[0].endpoint).not.toContain('raw-reply-token');
    expect(sent[0].content).toContain('[LINE DM] U123 said:');
    expect(sent[0].content).toContain('hello &lt;line&gt;');
    expect(JSON.stringify(sent[0])).not.toContain('raw-reply-token');
  });

  it('accepts signed POST verification body with empty events array', async () => {
    await signedPost(app, '/line/webhook', { destination: 'Ubot', events: [] }, 'root-secret').expect(200);

    expect(sent).toHaveLength(0);
  });
});
