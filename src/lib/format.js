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

export function formatMessage(type, userName, text, { groupName } = {}) {
  const prefix = type === 'dm'
    ? '[LINE DM]'
    : type === 'room'
      ? `[LINE ROOM:${escapeXml(groupName || 'unknown')}]`
      : `[LINE GROUP:${escapeXml(groupName || 'unknown')}]`;
  return `${prefix} ${escapeXml(userName)} said: <current-message>\n${escapeXml(text)}\n</current-message>`;
}
