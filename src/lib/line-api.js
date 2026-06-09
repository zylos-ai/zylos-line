import crypto from 'node:crypto';

export const LINE_API_BASE = 'https://api.line.me';

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function postLineMessage(path, body, {
  channelAccessToken,
  fetchImpl = fetch,
  retryKey = '',
  timeoutMs = 15000
} = {}) {
  if (!channelAccessToken) throw new Error('missing LINE channelAccessToken');

  const headers = {
    Authorization: `Bearer ${channelAccessToken}`,
    'Content-Type': 'application/json'
  };
  if (retryKey) headers['X-Line-Retry-Key'] = retryKey;

  const response = await fetchImpl(`${LINE_API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const result = await parseResponse(response);
  if (!response.ok) {
    const err = new Error(result.message || `LINE API HTTP ${response.status}`);
    err.status = response.status;
    err.body = result;
    throw err;
  }
  return {
    ok: true,
    status: response.status,
    ...result
  };
}

export function sendReplyMessage({ channelAccessToken, replyToken, messages }, deps = {}) {
  return postLineMessage('/v2/bot/message/reply', {
    replyToken,
    messages
  }, {
    ...deps,
    channelAccessToken
  });
}

export function sendPushMessage({ channelAccessToken, to, messages }, deps = {}) {
  return postLineMessage('/v2/bot/message/push', {
    to,
    messages
  }, {
    ...deps,
    channelAccessToken,
    retryKey: deps.retryKey || crypto.randomUUID()
  });
}
