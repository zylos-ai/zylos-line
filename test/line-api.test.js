import { describe, expect, it } from 'vitest';
import { sendPushMessage, sendReplyMessage } from '../src/lib/line-api.js';

function response(body = {}, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

describe('LINE API client', () => {
  it('does not attach retry keys to reply messages', async () => {
    const calls = [];
    await sendReplyMessage({
      channelAccessToken: 'token',
      replyToken: 'reply-token',
      messages: [{ type: 'text', text: 'hello' }]
    }, {
      fetchImpl: async (url, options) => {
        calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
        return response();
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(calls[0].headers).not.toHaveProperty('X-Line-Retry-Key');
    expect(calls[0].body).toEqual({
      replyToken: 'reply-token',
      messages: [{ type: 'text', text: 'hello' }]
    });
  });

  it('attaches retry keys to push messages', async () => {
    const calls = [];
    await sendPushMessage({
      channelAccessToken: 'token',
      to: 'U123',
      messages: [{ type: 'text', text: 'hello' }]
    }, {
      retryKey: '123e4567-e89b-12d3-a456-426614174000',
      fetchImpl: async (url, options) => {
        calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
        return response();
      }
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/push');
    expect(calls[0].headers['X-Line-Retry-Key']).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(calls[0].body).toEqual({
      to: 'U123',
      messages: [{ type: 'text', text: 'hello' }]
    });
  });
});
