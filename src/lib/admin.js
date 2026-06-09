import fs from 'node:fs';
import { CONFIG_PATH, DEFAULT_CONFIG } from './config.js';
import { PAIRING_STATE_FILE, loadPairingState, savePairingState } from './dm-pairing.js';
import { writeJsonAtomic } from './atomic-write.js';

const DM_POLICIES = new Set(['open', 'allowlist', 'owner', 'pairing', 'disabled']);
const GROUP_POLICIES = new Set(['open', 'allowlist', 'disabled']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensurePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function loadAdminConfig(filePath = CONFIG_PATH) {
  try {
    return ensurePlainObject(JSON.parse(fs.readFileSync(filePath, 'utf8')), 'config');
  } catch (err) {
    if (err?.code === 'ENOENT') return clone(DEFAULT_CONFIG);
    throw err;
  }
}

export function saveAdminConfig(config, filePath = CONFIG_PATH) {
  writeJsonAtomic(filePath, ensurePlainObject(config, 'config'), 0o600);
}

function assertSafeKey(value, label) {
  if (DANGEROUS_KEYS.has(value)) throw new Error(`invalid ${label}`);
}

export function normalizeUserId(userId) {
  const value = String(userId || '').trim();
  assertSafeKey(value, 'LINE user ID');
  if (!/^U[A-Za-z0-9_-]{1,127}$/.test(value)) throw new Error('invalid LINE user ID');
  return value;
}

export function normalizeConversationId(conversationId) {
  const value = String(conversationId || '').trim();
  assertSafeKey(value, 'LINE group/room ID');
  if (!/^[CR][A-Za-z0-9_-]{1,127}$/.test(value)) throw new Error('invalid LINE group/room ID');
  return value;
}

function normalizePolicy(policy, allowed, label) {
  const value = String(policy || '').trim();
  if (!allowed.has(value)) throw new Error(`invalid ${label}`);
  return value;
}

function asArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function uniqueAppend(list, value) {
  return list.some(item => String(item) === value) ? list : [...list, value];
}

function removeOne(list, value) {
  return list.filter(item => String(item) !== value);
}

function parseFlags(args) {
  const flags = new Set();
  const values = [];
  for (const arg of args) {
    if (String(arg).startsWith('--')) flags.add(arg);
    else values.push(arg);
  }
  return { flags, values };
}

function saveMutation(mutator, { configPath = CONFIG_PATH } = {}) {
  const config = loadAdminConfig(configPath);
  const result = mutator(config);
  saveAdminConfig(config, configPath);
  return result;
}

export function redactConfig(config) {
  const accounts = {};
  for (const [accountId, account] of Object.entries(config.accounts || {})) {
    accounts[accountId] = {
      name: account?.name || accountId,
      webhookPath: account?.webhookPath || '',
      hasChannelAccessToken: Boolean(account?.channelAccessToken || account?.channelAccessTokenFile),
      hasChannelSecret: Boolean(account?.channelSecret || account?.channelSecretFile)
    };
  }
  return {
    enabled: Boolean(config.enabled),
    port: config.port,
    webhookPath: config.webhookPath,
    hasDefaultCredentials: Boolean(config.channelAccessToken || config.channelAccessTokenFile || config.channelSecret || config.channelSecretFile),
    owner: {
      bound: Boolean(config.owner?.bound),
      userId: config.owner?.userId || '',
      name: config.owner?.name || ''
    },
    dmPolicy: config.dmPolicy || 'owner',
    dmAllowFrom: asArray(config.dmAllowFrom, 'dmAllowFrom'),
    groupPolicy: config.groupPolicy || 'allowlist',
    groups: config.groups || {},
    mediaMaxMb: config.mediaMaxMb,
    requestMaxBytes: config.requestMaxBytes,
    accounts
  };
}

export function runAdminCommand(argv, {
  configPath = CONFIG_PATH,
  pairingPath = PAIRING_STATE_FILE
} = {}) {
  const [command, subcommand, ...rest] = argv;

  if (command === 'status') {
    return redactConfig(loadAdminConfig(configPath));
  }

  if (command === 'owner' && subcommand === 'bind') {
    const { flags, values } = parseFlags(rest);
    const userId = normalizeUserId(values[0]);
    const name = values[1] || userId;
    return saveMutation(config => {
      if (config.owner?.bound && config.owner.userId && config.owner.userId !== userId && !flags.has('--force')) {
        throw new Error('owner already bound; pass --force to rebind');
      }
      config.owner = { bound: true, userId, name };
      return { ok: true, owner: config.owner };
    }, { configPath });
  }

  if (command === 'policy' && subcommand === 'dm') {
    const policy = normalizePolicy(rest[0], DM_POLICIES, 'DM policy');
    return saveMutation(config => {
      config.dmPolicy = policy;
      return { ok: true, dmPolicy: policy };
    }, { configPath });
  }

  if (command === 'policy' && subcommand === 'group') {
    const policy = normalizePolicy(rest[0], GROUP_POLICIES, 'group policy');
    return saveMutation(config => {
      config.groupPolicy = policy;
      return { ok: true, groupPolicy: policy };
    }, { configPath });
  }

  if (command === 'dm-allow' && subcommand === 'add') {
    const userId = normalizeUserId(rest[0]);
    return saveMutation(config => {
      const list = asArray(config.dmAllowFrom, 'dmAllowFrom');
      config.dmAllowFrom = uniqueAppend(list, userId);
      return { ok: true, dmAllowFrom: config.dmAllowFrom };
    }, { configPath });
  }

  if (command === 'dm-allow' && subcommand === 'remove') {
    const { flags, values } = parseFlags(rest);
    const userId = normalizeUserId(values[0]);
    return saveMutation(config => {
      const list = asArray(config.dmAllowFrom, 'dmAllowFrom');
      const next = removeOne(list, userId);
      if (list.length > 0 && next.length === 0 && !flags.has('--confirm-empty')) {
        throw new Error('refusing to empty dmAllowFrom without --confirm-empty');
      }
      config.dmAllowFrom = next;
      return { ok: true, dmAllowFrom: config.dmAllowFrom };
    }, { configPath });
  }

  if (command === 'group' && subcommand === 'add') {
    const { flags, values } = parseFlags(rest);
    const conversationId = normalizeConversationId(values[0]);
    const allowAll = flags.has('--allow-all');
    const userIds = values.slice(1).map(normalizeUserId);
    if (!allowAll && userIds.length === 0) throw new Error('group add requires --allow-all or at least one user ID');
    if (allowAll && userIds.length > 0) throw new Error('--allow-all cannot be combined with user IDs');
    return saveMutation(config => {
      if (!config.groups || typeof config.groups !== 'object' || Array.isArray(config.groups)) config.groups = {};
      assertSafeKey(conversationId, 'LINE group/room ID');
      const existing = config.groups[conversationId] && typeof config.groups[conversationId] === 'object' && !Array.isArray(config.groups[conversationId])
        ? config.groups[conversationId]
        : {};
      const current = asArray(existing.allowFrom, 'group allowFrom');
      config.groups[conversationId] = {
        ...existing,
        allowFrom: allowAll ? [] : userIds.reduce((list, id) => uniqueAppend(list, id), current)
      };
      return { ok: true, group: conversationId, allowFrom: config.groups[conversationId].allowFrom };
    }, { configPath });
  }

  if (command === 'group' && subcommand === 'remove-user') {
    const { flags, values } = parseFlags(rest);
    const conversationId = normalizeConversationId(values[0]);
    const userId = normalizeUserId(values[1]);
    return saveMutation(config => {
      const group = config.groups?.[conversationId];
      if (!group || typeof group !== 'object' || Array.isArray(group)) throw new Error('group/room is not configured');
      const list = asArray(group.allowFrom, 'group allowFrom');
      const next = removeOne(list, userId);
      if (list.length > 0 && next.length === 0 && !flags.has('--confirm-empty')) {
        throw new Error('refusing to empty group allowFrom without --confirm-empty');
      }
      config.groups[conversationId] = { ...group, allowFrom: next };
      return { ok: true, group: conversationId, allowFrom: next };
    }, { configPath });
  }

  if (command === 'pairing' && subcommand === 'list') {
    return loadPairingState(pairingPath);
  }

  if (command === 'pairing' && subcommand === 'approve') {
    const userId = normalizeUserId(rest[0]);
    const state = loadPairingState(pairingPath);
    if (!state.pending?.[userId]) throw new Error('pairing request not found');

    const addResult = saveMutation(config => {
      const list = asArray(config.dmAllowFrom, 'dmAllowFrom');
      config.dmAllowFrom = uniqueAppend(list, userId);
      return { ok: true, dmAllowFrom: config.dmAllowFrom };
    }, { configPath });

    const nextState = loadPairingState(pairingPath);
    if (nextState.pending?.[userId]) {
      delete nextState.pending[userId];
      delete nextState.denied?.[userId];
      savePairingState(nextState, pairingPath);
    }
    return { ok: true, approved: userId, dmAllowFrom: addResult.dmAllowFrom };
  }

  if (command === 'pairing' && subcommand === 'deny') {
    const userId = normalizeUserId(rest[0]);
    const state = loadPairingState(pairingPath);
    const request = state.pending?.[userId];
    if (!request) throw new Error('pairing request not found');
    delete state.pending[userId];
    state.denied[userId] = {
      ...request,
      deniedAt: new Date().toISOString()
    };
    savePairingState(state, pairingPath);
    return { ok: true, denied: userId };
  }

  throw new Error('unknown admin command');
}
