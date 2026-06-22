import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from './atomic-write.js';

const HOME = process.env.HOME || '';
export const DATA_DIR = path.join(HOME, 'zylos/components/line');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const LOG_DIR = path.join(DATA_DIR, 'logs');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');

export const DEFAULT_CONFIG = {
  enabled: true,
  port: 3984,
  channelAccessToken: '',
  channelAccessTokenFile: '',
  channelSecret: '',
  channelSecretFile: '',
  webhookPath: '/line/webhook',
  accounts: {},
  owner: {
    bound: false,
    userId: '',
    name: ''
  },
  dmPolicy: 'owner',
  dmAllowFrom: [],
  groupPolicy: 'allowlist',
  groups: {},
  message: {
    context_messages: 10
  },
  mediaMaxMb: 20,
  replyTokenTtlMs: 60_000,
  webhookDedupTtlMs: 24 * 60 * 60 * 1000,
  requestMaxBytes: '1mb'
};

let config = null;

function readSecretFile(filePath) {
  if (!filePath) return '';
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return '';
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function normalizePath(rawPath, fallback) {
  const value = String(rawPath || fallback || '').trim();
  if (!value.startsWith('/')) return fallback;
  if (/\/\/|[?#%\\]|\.\.|\p{Cc}|\s|[<>"'`&]/u.test(value)) return fallback;
  return value.replace(/\/$/, '') || fallback;
}

function normalizeMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

export function mergeConfigWithDefaults(parsed = {}) {
  const merged = {
    ...DEFAULT_CONFIG,
    ...parsed,
    accounts: normalizeMap(parsed.accounts),
    groups: normalizeMap(parsed.groups),
    owner: {
      ...DEFAULT_CONFIG.owner,
      ...(parsed.owner || {})
    },
    message: {
      ...DEFAULT_CONFIG.message,
      ...(parsed.message || {})
    }
  };

  merged.webhookPath = normalizePath(merged.webhookPath, DEFAULT_CONFIG.webhookPath);
  merged.channelAccessToken = merged.channelAccessToken
    || readSecretFile(merged.channelAccessTokenFile)
    || process.env.LINE_CHANNEL_ACCESS_TOKEN
    || '';
  merged.channelSecret = merged.channelSecret
    || readSecretFile(merged.channelSecretFile)
    || process.env.LINE_CHANNEL_SECRET
    || '';
  merged.port = Number.isFinite(Number(merged.port)) ? Number(merged.port) : DEFAULT_CONFIG.port;
  merged.mediaMaxMb = Number.isFinite(Number(merged.mediaMaxMb)) ? Math.max(1, Number(merged.mediaMaxMb)) : DEFAULT_CONFIG.mediaMaxMb;
  merged.replyTokenTtlMs = Number.isFinite(Number(merged.replyTokenTtlMs)) ? Math.max(1000, Number(merged.replyTokenTtlMs)) : DEFAULT_CONFIG.replyTokenTtlMs;
  merged.webhookDedupTtlMs = Number.isFinite(Number(merged.webhookDedupTtlMs)) ? Math.max(1000, Number(merged.webhookDedupTtlMs)) : DEFAULT_CONFIG.webhookDedupTtlMs;
  return merged;
}

export function getAccounts(cfg = getConfig()) {
  const accounts = new Map();
  accounts.set('default', normalizeAccount('default', {
    channelAccessToken: cfg.channelAccessToken,
    channelSecret: cfg.channelSecret,
    webhookPath: cfg.webhookPath
  }));

  for (const [id, account] of Object.entries(cfg.accounts || {})) {
    accounts.set(id, normalizeAccount(id, account));
  }

  const seenPaths = new Set();
  for (const account of accounts.values()) {
    if (seenPaths.has(account.webhookPath)) {
      throw new Error(`duplicate LINE webhookPath: ${account.webhookPath}`);
    }
    seenPaths.add(account.webhookPath);
  }
  return [...accounts.values()];
}

export function findAccountByPath(requestPath, cfg = getConfig()) {
  return getAccounts(cfg).find(account => account.webhookPath === requestPath) || null;
}

export function findAccountById(accountId = 'default', cfg = getConfig()) {
  return getAccounts(cfg).find(account => account.id === (accountId || 'default')) || null;
}

function normalizeAccount(id, account = {}) {
  return {
    id,
    channelAccessToken: account.channelAccessToken
      || readSecretFile(account.channelAccessTokenFile)
      || '',
    channelSecret: account.channelSecret
      || readSecretFile(account.channelSecretFile)
      || '',
    webhookPath: normalizePath(account.webhookPath, id === 'default' ? DEFAULT_CONFIG.webhookPath : `/line/webhook/${id}`),
    name: account.name || id
  };
}

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = mergeConfigWithDefaults(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    } else {
      config = mergeConfigWithDefaults();
    }
  } catch (err) {
    console.error(`[line] Failed to load config: ${err.message}`);
    config = mergeConfigWithDefaults();
  }
  return config;
}

export function getConfig() {
  if (!config) return loadConfig();
  return config;
}

export function setConfigForTests(nextConfig) {
  config = nextConfig;
}

export function saveConfig(nextConfig) {
  const normalized = mergeConfigWithDefaults(nextConfig);
  writeJsonAtomic(CONFIG_PATH, normalized, 0o600);
  config = normalized;
  return normalized;
}

export function ensureRuntimeDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(MEDIA_DIR, { recursive: true, mode: 0o700 });
}
