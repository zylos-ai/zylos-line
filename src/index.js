#!/usr/bin/env node
import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './routes.js';
import { DATA_DIR, getConfig, loadConfig } from './lib/config.js';
import { sendToC4 } from './lib/c4.js';
import { EventDedupeStore } from './lib/event-dedupe.js';
import { ReplyTokenStore } from './lib/reply-token-store.js';

dotenv.config({ path: path.join(process.env.HOME || '', 'zylos/.env') });

function ensureInternalToken() {
  const tokenPath = path.join(DATA_DIR, '.internal-token');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    return fs.readFileSync(tokenPath, 'utf8').trim();
  } catch {
    const token = cryptoRandom();
    fs.writeFileSync(tokenPath, token, { mode: 0o600 });
    return token;
  }
}

function cryptoRandom() {
  return randomBytes(32).toString('hex');
}

const config = loadConfig();
fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });

const app = createApp({
  internalToken: ensureInternalToken(),
  sendToC4,
  replyTokenStore: new ReplyTokenStore(),
  eventDedupeStore: new EventDedupeStore({ ttlMs: config.webhookDedupTtlMs })
});

const port = config.port || getConfig().port || 3984;
app.listen(port, '127.0.0.1', () => {
  console.log(`[line] Listening on 127.0.0.1:${port}`);
});
