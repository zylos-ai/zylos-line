import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { writeJsonAtomic } from './atomic-write.js';

export const REPLY_TOKENS_PATH = path.join(DATA_DIR, 'reply-tokens.json');

export class ReplyTokenStore {
  constructor({ filePath = REPLY_TOKENS_PATH, now = () => Date.now() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.state = this.#read();
  }

  create({ accountId, targetId, replyToken, ttlMs }) {
    if (!replyToken) return '';
    const key = crypto.randomBytes(16).toString('hex');
    this.#prune();
    this.state[key] = {
      accountId,
      targetId,
      replyToken,
      consumed: false,
      expiresAt: this.now() + ttlMs
    };
    this.#write();
    return key;
  }

  consume(key) {
    this.#prune();
    const entry = this.state[key];
    if (!entry || entry.consumed || entry.expiresAt <= this.now()) {
      this.#write();
      return null;
    }
    entry.consumed = true;
    this.#write();
    return entry;
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return parsed;
    } catch {
      return {};
    }
  }

  #write() {
    writeJsonAtomic(this.filePath, this.state, 0o600);
  }

  #prune() {
    const now = this.now();
    for (const [key, entry] of Object.entries(this.state)) {
      if (!entry || entry.expiresAt <= now) delete this.state[key];
    }
  }
}
