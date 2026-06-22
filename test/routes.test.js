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
      owner: {
        bound: true,
        userId: 'U123',
        name: 'Owner'
      },
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

  it('silently drops denied DMs before creating a replyKey', async () => {
    const replyTokenStore = new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 });
    setConfigForTests(mergeConfigWithDefaults({
      channelSecret: 'root-secret',
      channelAccessToken: 'root-token',
      owner: { bound: true, userId: 'Uowner', name: 'Owner' },
      dmPolicy: 'owner'
    }));
    app = createApp({
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore,
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 }),
      logger: { debug: vi.fn() }
    });
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-denied',
        replyToken: 'raw-denied-token',
        source: { type: 'user', userId: 'Udenied' },
        message: { type: 'text', text: 'hello' }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(sent).toHaveLength(0);
    expect(JSON.stringify(fs.existsSync(replyTokenStore.filePath) ? JSON.parse(fs.readFileSync(replyTokenStore.filePath, 'utf8')) : {})).not.toContain('raw-denied-token');
  });

  it('queues pairing requests internally but does not deliver the original DM', async () => {
    setConfigForTests(mergeConfigWithDefaults({
      channelSecret: 'root-secret',
      channelAccessToken: 'root-token',
      owner: { bound: true, userId: 'Uowner', name: 'Owner' },
      dmPolicy: 'pairing'
    }));
    app = createApp({
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore: new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 }),
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 }),
      decideAccess: ({ accountId }) => ({
        allowed: false,
        reason: 'dm-pairing-pending',
        notification: {
          endpoint: `admin|type:dm-pairing|account:${accountId}|user:Unew`,
          content: '[LINE DM Pairing Request]'
        }
      })
    });
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-pairing',
        replyToken: 'raw-pairing-token',
        source: { type: 'user', userId: 'Unew' },
        message: { type: 'text', text: 'hello' }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(sent).toEqual([{
      channel: 'line',
      endpoint: 'admin|type:dm-pairing|account:default|user:Unew',
      content: '[LINE DM Pairing Request]'
    }]);
  });

  it('accepts configured group events even when LINE omits source.userId', async () => {
    setConfigForTests(mergeConfigWithDefaults({
      channelSecret: 'root-secret',
      channelAccessToken: 'root-token',
      owner: { bound: true, userId: 'Uowner', name: 'Owner' },
      groups: {
        G123: { allowFrom: [] }
      },
      replyTokenTtlMs: 60_000,
      webhookDedupTtlMs: 60_000
    }));
    app = createApp({
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore: new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 }),
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 })
    });
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-group-no-user',
        replyToken: 'reply-group',
        source: { type: 'group', groupId: 'G123' },
        message: { type: 'text', text: 'group hello' }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toContain('G123|type:group|account:default|replyKey:');
    expect(sent[0].endpoint).not.toContain('|user:');
    expect(sent[0].content).toContain('[LINE GROUP:G123] unknown said:');
  });

  it('downloads inbound media by LINE message id and forwards the file path', async () => {
    const downloadMedia = vi.fn(async ({ messageId, channelAccessToken }) => ({
      filePath: `/tmp/${messageId}.png`,
      contentType: 'image/png',
      bytes: 10
    }));
    app = createApp({
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore: new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 }),
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 }),
      downloadMedia
    });
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-image',
        replyToken: 'reply-image',
        source: { type: 'user', userId: 'U123' },
        message: { type: 'image', id: 'img_123' }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(downloadMedia).toHaveBeenCalledWith({
      messageId: 'img_123',
      channelAccessToken: 'root-token',
      config: expect.objectContaining({ mediaMaxMb: 20 })
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain('&lt;media:image&gt;');
    expect(sent[0].content).toContain('---- file: /tmp/img_123.png');
  });

  it('rejects inbound media with invalid LINE message ids before download or replyKey creation', async () => {
    const replyTokenStore = new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 });
    const downloadMedia = vi.fn();
    app = createApp({
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore,
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 }),
      downloadMedia,
      logger: { warn: vi.fn(), debug: vi.fn() }
    });
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-bad-media',
        replyToken: 'reply-bad-media',
        source: { type: 'user', userId: 'U123' },
        message: { type: 'image', id: '../secret' }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(downloadMedia).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(JSON.stringify(fs.existsSync(replyTokenStore.filePath) ? JSON.parse(fs.readFileSync(replyTokenStore.filePath, 'utf8')) : {})).not.toContain('reply-bad-media');
  });

  it('forwards inbound stickers as a keyword placeholder without a content download (F4)', async () => {
    const downloadMedia = vi.fn();
    app = createApp({
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore: new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 }),
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 }),
      downloadMedia
    });
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-sticker',
        replyToken: 'reply-sticker',
        source: { type: 'user', userId: 'U123' },
        message: { type: 'sticker', id: 's1', packageId: '11537', stickerId: '52002734', keywords: ['Love', 'Happy'] }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(downloadMedia).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain('[Sticker: Love, Happy]');
  });

  it('forwards inbound location as a text placeholder with title, address and coordinates (F5)', async () => {
    app = createApp({
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore: new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 }),
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 })
    });
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-loc',
        replyToken: 'reply-loc',
        source: { type: 'user', userId: 'U123' },
        message: { type: 'location', id: 'l1', title: 'Cafe', address: '1 Main St', latitude: 35.6595, longitude: 139.7005 }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain('[Location: Cafe — 1 Main St (35.6595, 139.7005)]');
  });

  it('does not silently drop oversized/failed media — forwards a descriptive placeholder (F3)', async () => {
    const downloadMedia = vi.fn(async () => { throw new Error('inbound media exceeds size limit'); });
    app = createApp({
      sendToC4: vi.fn((channel, endpoint, content) => sent.push({ channel, endpoint, content })),
      replyTokenStore: new ReplyTokenStore({ filePath: tempFile('reply.json'), now: () => 1000 }),
      eventDedupeStore: new EventDedupeStore({ filePath: tempFile('dedupe.json'), now: () => 1000, ttlMs: 60_000 }),
      downloadMedia,
      logger: { warn: vi.fn(), debug: vi.fn() }
    });
    const body = {
      destination: 'Ubot',
      events: [{
        type: 'message',
        webhookEventId: 'evt-bigfile',
        replyToken: 'reply-bigfile',
        source: { type: 'user', userId: 'U123' },
        message: { type: 'file', id: 'file_123' }
      }]
    };

    await signedPost(app, '/line/webhook', body, 'root-secret').expect(200);

    expect(downloadMedia).toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain('[file too large (over the 20 MB limit)]');
    expect(sent[0].content).not.toContain('---- file:');
  });
});
