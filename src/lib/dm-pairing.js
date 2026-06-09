import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { writeJsonAtomic } from './atomic-write.js';

export const PAIRING_STATE_FILE = path.join(DATA_DIR, 'dm-pairing.json');

function normalizeUserId(userId) {
  return String(userId || '').trim();
}

export function loadPairingState(filePath = PAIRING_STATE_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { pending: {}, denied: {} };
    throw err;
  }
  const parsed = JSON.parse(raw);
  return {
    pending: parsed?.pending && typeof parsed.pending === 'object' && !Array.isArray(parsed.pending) ? parsed.pending : {},
    denied: parsed?.denied && typeof parsed.denied === 'object' && !Array.isArray(parsed.denied) ? parsed.denied : {}
  };
}

export function loadPairingStateOrEmpty(filePath = PAIRING_STATE_FILE) {
  try {
    return loadPairingState(filePath);
  } catch {
    return { pending: {}, denied: {} };
  }
}

export function savePairingState(state, filePath = PAIRING_STATE_FILE) {
  writeJsonAtomic(filePath, {
    pending: state.pending || {},
    denied: state.denied || {}
  }, 0o600);
}

export function getPairingStatus(userId, state) {
  const id = normalizeUserId(userId);
  if (!id) return 'unknown';
  if (state.denied?.[id]) return 'denied';
  if (state.pending?.[id]) return 'pending';
  return 'unknown';
}

export function markPairingPending({ userId, userName, conversationId, firstMessage }, state) {
  const id = normalizeUserId(userId);
  if (!id) return state;
  if (!state.pending) state.pending = {};
  if (!state.denied) state.denied = {};
  if (!state.pending[id] && !state.denied[id]) {
    state.pending[id] = {
      userId: id,
      userName: userName || id,
      conversationId: conversationId || '',
      firstMessage: String(firstMessage || '').slice(0, 500),
      requestedAt: new Date().toISOString()
    };
  }
  return state;
}

export function buildPairingNotification({ userId, userName, conversationId, firstMessage }) {
  return [
    '[LINE DM Pairing Request]',
    `${userName || userId || 'unknown'} (${userId || 'unknown'}) requested DM access.`,
    `Conversation: ${conversationId || 'unknown'}`,
    firstMessage ? `First message: ${String(firstMessage).slice(0, 500)}` : '',
    '',
    `Approve: node scripts/admin.js pairing approve ${userId}`,
    `Deny: node scripts/admin.js pairing deny ${userId}`
  ].filter(line => line !== '').join('\n');
}
