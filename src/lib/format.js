export function escapeXml(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

export function parseC4Response(stdout) {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

export function lineSourceType(source = {}) {
  if (source.type === 'group') return 'group';
  if (source.type === 'room') return 'room';
  return 'dm';
}

export function lineTargetId(source = {}) {
  if (source.type === 'group') return source.groupId || '';
  if (source.type === 'room') return source.roomId || '';
  return source.userId || '';
}

export function buildEndpoint(targetId, { type, accountId, userId, replyKey } = {}) {
  let endpoint = targetId;
  if (type) endpoint += `|type:${type}`;
  if (accountId) endpoint += `|account:${accountId}`;
  if (userId) endpoint += `|user:${userId}`;
  if (replyKey) endpoint += `|replyKey:${replyKey}`;
  return endpoint;
}

const ENDPOINT_KEYS = new Set(['type', 'account', 'user', 'replyKey']);

export function parseEndpoint(endpoint) {
  const parts = String(endpoint || '').split('|');
  const parsed = {
    targetId: parts[0] || '',
    type: 'dm',
    account: 'default',
    user: '',
    replyKey: ''
  };
  for (const part of parts.slice(1)) {
    const colonIdx = part.indexOf(':');
    if (colonIdx <= 0) continue;
    const key = part.slice(0, colonIdx);
    if (!ENDPOINT_KEYS.has(key)) continue;
    parsed[key] = part.slice(colonIdx + 1);
  }
  if (!parsed.account) parsed.account = 'default';
  if (!parsed.type) parsed.type = 'dm';
  return parsed;
}

export function formatMessage(type, userName, text, { groupName, filePath } = {}) {
  const prefix = type === 'dm'
    ? '[LINE DM]'
    : type === 'room'
      ? `[LINE ROOM:${escapeXml(groupName || 'unknown')}]`
      : `[LINE GROUP:${escapeXml(groupName || 'unknown')}]`;
  const suffix = filePath ? ` ---- file: ${escapeXml(filePath)}` : '';
  return `${prefix} ${escapeXml(userName)} said: <current-message>\n${escapeXml(text)}\n</current-message>${suffix}`;
}
