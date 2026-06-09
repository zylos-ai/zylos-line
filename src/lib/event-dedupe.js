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
    this.state = this.#read();
  }

  seen(accountId, eventId) {
    if (!eventId) return false;
    const key = `${accountId}:${eventId}`;
    this.#prune();
    if (this.state[key] && this.state[key] > this.now()) {
      this.#write();
      return true;
    }
    this.state[key] = this.now() + this.ttlMs;
    this.#write();
    return false;
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
    for (const [key, expiresAt] of Object.entries(this.state)) {
      if (expiresAt <= now) delete this.state[key];
    }
  }
}
