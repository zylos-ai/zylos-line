import { saveConfig } from './config.js';
import {
  buildPairingNotification,
  getPairingStatus,
  loadPairingState,
  markPairingPending,
  savePairingState
} from './dm-pairing.js';
import { lineSourceType, lineTargetId } from './format.js';

function listIncludes(list = [], value = '') {
  if (!value || !Array.isArray(list)) return false;
  return list.some(entry => String(entry) === String(value));
}

function getGroupConfig(config, targetId) {
  const groups = config.groups || {};
  const entry = groups[targetId];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  return entry;
}

export function isOwner(config, userId) {
  return Boolean(config.owner?.bound && config.owner.userId && String(config.owner.userId) === String(userId || ''));
}

export function bindOwnerIfNeeded(config, { userId, userName }, { save = saveConfig } = {}) {
  if (config.owner?.bound || !userId) return false;
  const nextConfig = {
    ...config,
    owner: {
      bound: true,
      userId,
      name: userName || userId
    }
  };
  const saved = save(nextConfig) || nextConfig;
  Object.assign(config, saved);
  return true;
}

export function decideInboundAccess({
  config,
  accountId,
  event,
  text,
  loadPairing = loadPairingState,
  savePairing = savePairingState,
  save = saveConfig
} = {}) {
  const source = event?.source || {};
  const type = lineSourceType(source);
  const targetId = lineTargetId(source);
  const userId = String(source.userId || '').trim();
  const userName = userId || 'unknown';

  if (!targetId) return { allowed: false, reason: 'missing-target' };
  if (!userId && type === 'dm') return { allowed: false, reason: 'missing-user' };

  if (type === 'dm') {
    try {
      bindOwnerIfNeeded(config, { userId, userName }, { save });
    } catch {
      return { allowed: false, reason: 'owner-bind-error' };
    }
  }

  if (userId && isOwner(config, userId)) {
    return { allowed: true, reason: 'owner' };
  }

  if (type === 'dm') {
    const policy = config.dmPolicy || 'owner';
    if (policy === 'open') return { allowed: true, reason: 'dm-open' };
    if (policy === 'allowlist') {
      return listIncludes(config.dmAllowFrom, userId)
        ? { allowed: true, reason: 'dm-allowlist' }
        : { allowed: false, reason: 'dm-allowlist' };
    }
    if (policy === 'pairing') {
      let state;
      try {
        state = loadPairing();
      } catch {
        return { allowed: false, reason: 'pairing-state-error' };
      }
      if (listIncludes(config.dmAllowFrom, userId)) return { allowed: true, reason: 'dm-pairing-approved' };
      const status = getPairingStatus(userId, state);
      if (status === 'denied') return { allowed: false, reason: 'dm-pairing-denied' };
      let notification = null;
      if (status !== 'pending') {
        try {
          markPairingPending({
            userId,
            userName,
            conversationId: targetId,
            firstMessage: text
          }, state);
          savePairing(state);
        } catch {
          return { allowed: false, reason: 'pairing-state-error' };
        }
        notification = {
          endpoint: `admin|type:dm-pairing|account:${accountId || 'default'}|user:${userId}`,
          content: buildPairingNotification({
            userId,
            userName,
            conversationId: targetId,
            firstMessage: text
          })
        };
      }
      return { allowed: false, reason: 'dm-pairing-pending', notification };
    }
    return { allowed: false, reason: `dm-${policy}` };
  }

  const groupPolicy = config.groupPolicy || 'allowlist';
  if (groupPolicy === 'disabled') return { allowed: false, reason: 'group-disabled' };

  const groupConfig = getGroupConfig(config, targetId);
  const configured = Boolean(groupConfig);
  if (groupPolicy !== 'open' && !configured) {
    return { allowed: false, reason: 'group-unconfigured' };
  }

  const allowFrom = Array.isArray(groupConfig?.allowFrom) ? groupConfig.allowFrom : [];
  if (allowFrom.length > 0 && !listIncludes(allowFrom, userId)) {
    return { allowed: false, reason: 'group-allowFrom' };
  }

  return { allowed: true, reason: configured ? 'group-configured' : 'group-open' };
}
