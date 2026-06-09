import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { buildEndpoint } from '../src/lib/format.js';
import { ReplyTokenStore } from '../src/lib/reply-token-store.js';
import { deterministicRetryKey, main, sendContent, toLineMessages } from '../scripts/send.js';

function tempStore(nowRef = { value: 1000 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-send-'));
  return new ReplyTokenStore({ filePath: path.join(dir, 'reply.json'), now: () => nowRef.value });
}

function config() {
  return {
    enabled: true,
    channelAccessToken: 'root-token',
    channelSecret: 'root-secret',
    webhookPath: '/line/webhook',
    accounts: {
      alt: {
        channelAccessToken: 'alt-token',
        channelSecret: 'alt-secret',
        webhookPath: '/line/webhook/alt'
      }
    }
  };
}

function stdinFrom(text) {
  return Readable.from([text]);
}

describe('scripts/send.js', () => {
  it('consumes a replyKey once and uses reply API for the first batch', async () => {
    const store = tempStore();
    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 60_000
    });
    const endpoint = buildEndpoint('U123', { type: 'dm', accountId: 'default', userId: 'U123', replyKey: key });
    const calls = [];

    await sendContent(endpoint, 'hello', {
      config: config(),
      replyTokenStore: store,
      sendReply: vi.fn(async payload => {
        calls.push({ api: 'reply', payload });
        return { ok: true };
      }),
      sendPush: vi.fn(async payload => {
        calls.push({ api: 'push', payload });
        return { ok: true };
      })
    });
    await sendContent(endpoint, 'again', {
      config: config(),
      replyTokenStore: store,
      sendReply: vi.fn(async payload => {
        calls.push({ api: 'reply', payload });
        return { ok: true };
      }),
      sendPush: vi.fn(async payload => {
        calls.push({ api: 'push', payload });
        return { ok: true };
      })
    });

    expect(calls).toEqual([
      {
        api: 'reply',
        payload: {
          channelAccessToken: 'root-token',
          replyToken: 'raw-reply-token',
          messages: [{ type: 'text', text: 'hello' }]
        }
      },
      {
        api: 'push',
        payload: {
          channelAccessToken: 'root-token',
          to: 'U123',
          messages: [{ type: 'text', text: 'again' }],
          retryKey: expect.stringMatching(/^[a-f0-9-]{36}$/)
        }
      }
    ]);
  });

  it('uses reply API for up to five messages and push for overflow', async () => {
    const store = tempStore();
    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 60_000
    });
    const endpoint = buildEndpoint('U123', { type: 'dm', accountId: 'default', replyKey: key });
    const calls = [];
    const text = `${'a'.repeat(5000 * 5)}b`;

    await sendContent(endpoint, text, {
      config: config(),
      replyTokenStore: store,
      sendReply: vi.fn(async payload => {
        calls.push({ api: 'reply', count: payload.messages.length, lengths: payload.messages.map(msg => msg.text.length) });
        return { ok: true };
      }),
      sendPush: vi.fn(async payload => {
        calls.push({ api: 'push', count: payload.messages.length, lengths: payload.messages.map(msg => msg.text.length) });
        return { ok: true };
      })
    });

    expect(calls).toEqual([
      { api: 'reply', count: 5, lengths: [5000, 5000, 5000, 5000, 5000] },
      { api: 'push', count: 1, lengths: [1] }
    ]);
  });

  it('falls back to push when the reply token has expired', async () => {
    const nowRef = { value: 1000 };
    const store = tempStore(nowRef);
    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 10
    });
    nowRef.value = 1011;
    const calls = [];

    await sendContent(buildEndpoint('U123', { type: 'dm', accountId: 'default', replyKey: key }), 'late', {
      config: config(),
      replyTokenStore: store,
      sendReply: vi.fn(async payload => {
        calls.push({ api: 'reply', payload });
        return { ok: true };
      }),
      sendPush: vi.fn(async payload => {
        calls.push({ api: 'push', payload });
        return { ok: true };
      })
    });

    expect(calls).toEqual([{
      api: 'push',
      payload: {
        channelAccessToken: 'root-token',
        to: 'U123',
        messages: [{ type: 'text', text: 'late' }],
        retryKey: expect.stringMatching(/^[a-f0-9-]{36}$/)
      }
    }]);
  });

  it('falls back to push when LINE rejects an expired reply token', async () => {
    const store = tempStore();
    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 60_000
    });
    const replyError = new Error('Invalid reply token');
    replyError.status = 400;
    const calls = [];

    await sendContent(buildEndpoint('U123', { type: 'dm', accountId: 'default', replyKey: key }), 'late-at-line', {
      config: config(),
      replyTokenStore: store,
      sendReply: vi.fn(async payload => {
        calls.push({ api: 'reply', payload });
        throw replyError;
      }),
      sendPush: vi.fn(async payload => {
        calls.push({ api: 'push', payload });
        return { ok: true };
      })
    });

    expect(calls).toEqual([
      {
        api: 'reply',
        payload: {
          channelAccessToken: 'root-token',
          replyToken: 'raw-reply-token',
          messages: [{ type: 'text', text: 'late-at-line' }]
        }
      },
      {
        api: 'push',
        payload: {
          channelAccessToken: 'root-token',
          to: 'U123',
          messages: [{ type: 'text', text: 'late-at-line' }],
          retryKey: expect.stringMatching(/^[a-f0-9-]{36}$/)
        }
      }
    ]);
  });

  it('does not fall back to push for non-token reply failures', async () => {
    const store = tempStore();
    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 60_000
    });
    const sendPush = vi.fn();
    const replyError = new Error('invalid message object');
    replyError.status = 400;

    await expect(sendContent(buildEndpoint('U123', { type: 'dm', accountId: 'default', replyKey: key }), 'bad', {
      config: config(),
      replyTokenStore: store,
      sendReply: vi.fn(async () => {
        throw replyError;
      }),
      sendPush
    })).rejects.toThrow(/invalid message object/);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('sends proactive messages by push in batches of five', async () => {
    const calls = [];
    await sendContent('U123|type:dm|account:default', `${'a'.repeat(5000 * 5)}b`, {
      config: config(),
      replyTokenStore: tempStore(),
      sendReply: vi.fn(async payload => {
        calls.push({ api: 'reply', payload });
        return { ok: true };
      }),
      sendPush: vi.fn(async payload => {
        calls.push({ api: 'push', count: payload.messages.length });
        return { ok: true };
      })
    });

    expect(calls).toEqual([
      { api: 'push', count: 5 },
      { api: 'push', count: 1 }
    ]);
  });

  it('uses the endpoint account token', async () => {
    const calls = [];
    await sendContent('Ualt|type:dm|account:alt', 'hello', {
      config: config(),
      replyTokenStore: tempStore(),
      sendPush: vi.fn(async payload => {
        calls.push(payload);
        return { ok: true };
      })
    });

    expect(calls[0].channelAccessToken).toBe('alt-token');
  });

  it('uses deterministic push retry keys for the same logical batch', async () => {
    const first = [];
    const second = [];
    const deps = calls => ({
      config: config(),
      replyTokenStore: tempStore(),
      sendPush: vi.fn(async payload => {
        calls.push(payload.retryKey);
        return { ok: true };
      })
    });

    await sendContent('U123|type:dm|account:default', 'hello retry', deps(first));
    await sendContent('U123|type:dm|account:default', 'hello retry', deps(second));

    expect(first).toEqual(second);
    expect(first[0]).toBe(deterministicRetryKey({
      accountId: 'default',
      targetId: 'U123',
      messages: [{ type: 'text', text: 'hello retry' }],
      batchIndex: 0
    }));
  });

  it('turns outbound media markers into validated LINE media messages', async () => {
    const calls = [];
    const validateMedia = vi.fn(async (url, { mediaType }) => ({
      url: `${url}?checked=${mediaType}`
    }));

    await sendContent('U123|type:dm|account:default', [
      'before',
      '[MEDIA:image]https://media.example.com/photo.png',
      '[MEDIA:video]https://media.example.com/movie.mp4 https://media.example.com/preview.jpg',
      '[MEDIA:audio]https://media.example.com/audio.m4a 12000',
      'after'
    ].join('\n'), {
      config: config(),
      replyTokenStore: tempStore(),
      validateMedia,
      sendPush: vi.fn(async payload => {
        calls.push(payload.messages);
        return { ok: true };
      })
    });

    expect(calls[0]).toEqual([
      { type: 'text', text: 'before' },
      {
        type: 'image',
        originalContentUrl: 'https://media.example.com/photo.png?checked=image',
        previewImageUrl: 'https://media.example.com/photo.png?checked=image'
      },
      {
        type: 'video',
        originalContentUrl: 'https://media.example.com/movie.mp4?checked=video',
        previewImageUrl: 'https://media.example.com/preview.jpg?checked=image'
      },
      {
        type: 'audio',
        originalContentUrl: 'https://media.example.com/audio.m4a?checked=audio',
        duration: 12000
      },
      { type: 'text', text: 'after' }
    ]);
  });

  it('requires preview URLs for outbound video media markers', async () => {
    await expect(toLineMessages('[MEDIA:video]https://media.example.com/movie.mp4', {
      config: config(),
      validateMedia: vi.fn(async url => ({ url }))
    })).rejects.toThrow(/preview image URL/);
  });

  it('skips [SKIP] without sending', async () => {
    const sendPush = vi.fn();
    const result = await sendContent('U123|type:dm|account:default', '[SKIP]', {
      config: config(),
      replyTokenStore: tempStore(),
      sendPush
    });

    expect(result).toEqual([]);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('supports CLI content from argv and stdin', async () => {
    const calls = [];
    const deps = {
      config: config(),
      replyTokenStore: tempStore(),
      sendPush: vi.fn(async payload => {
        calls.push(payload.messages[0].text);
        return { ok: true };
      })
    };

    expect(await main(['U123|type:dm|account:default', 'arg', 'text'], stdinFrom('ignored'), deps)).toBe(0);
    expect(await main(['U123|type:dm|account:default'], stdinFrom('stdin text'), deps)).toBe(0);
    expect(calls).toEqual(['arg text', 'stdin text']);
  });
});
