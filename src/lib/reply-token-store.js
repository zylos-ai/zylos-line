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
  }

  create({ accountId, targetId, replyToken, ttlMs }) {
    if (!replyToken) return '';
    const key = crypto.randomBytes(16).toString('hex');
    const state = this.#read();
    this.#prune(state);
    state[key] = {
      accountId,
      targetId,
      replyToken,
      consumed: false,
      expiresAt: this.now() + ttlMs
    };
    this.#write(state);
    return key;
  }

  consume(key) {
    const state = this.#read();
    this.#prune(state);
    const entry = state[key];
    if (!entry || entry.consumed || entry.expiresAt <= this.now()) {
      this.#write(state);
      return null;
    }
    entry.consumed = true;
    this.#write(state);
    return entry;
  }

  #read() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  #write(state) {
    writeJsonAtomic(this.filePath, state, 0o600);
  }

  #prune(state) {
    const now = this.now();
    for (const [key, entry] of Object.entries(state)) {
      if (!entry || entry.expiresAt <= now) delete state[key];
    }
  }
}
