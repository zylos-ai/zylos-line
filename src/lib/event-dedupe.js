import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { writeJsonAtomic } from './atomic-write.js';

export const EVENT_DEDUPE_PATH = path.join(DATA_DIR, 'event-dedupe.json');

export class EventDedupeStore {
  constructor({ filePath = EVENT_DEDUPE_PATH, now = () => Date.now(), ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.ttlMs = ttlMs;
  }

  seen(accountId, eventId) {
    if (!eventId) return false;
    const key = `${accountId}:${eventId}`;
    const state = this.#read();
    this.#prune(state);
    if (state[key] && state[key] > this.now()) {
      this.#write(state);
      return true;
    }
    state[key] = this.now() + this.ttlMs;
    this.#write(state);
    return false;
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
    for (const [key, expiresAt] of Object.entries(state)) {
      if (expiresAt <= now) delete state[key];
    }
  }
}
