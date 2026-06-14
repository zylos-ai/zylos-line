import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { writeJsonAtomic } from './atomic-write.js';

export const REPLY_TOKENS_PATH = path.join(DATA_DIR, 'reply-tokens.json');
const DEFAULT_STALE_LOCK_MS = 5000;
const DEFAULT_LOCK_TIMEOUT_MS = DEFAULT_STALE_LOCK_MS + 1000;
const LOCK_RETRY_MS = 10;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class ReplyTokenStore {
  constructor({
    filePath = REPLY_TOKENS_PATH,
    now = () => Date.now(),
    lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    staleLockMs = DEFAULT_STALE_LOCK_MS
  } = {}) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.now = now;
    this.lockTimeoutMs = lockTimeoutMs;
    this.staleLockMs = staleLockMs;
  }

  create({ accountId, targetId, replyToken, ttlMs }) {
    if (!replyToken) return '';
    return this.#withLock(() => {
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
    });
  }

  consume(key) {
    return this.#withLock(() => {
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
    });
  }

  #withLock(fn) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const lock = this.#acquireLock();
    try {
      return fn();
    } finally {
      try {
        fs.closeSync(lock.fd);
      } finally {
        this.#releaseLock(lock.id);
      }
    }
  }

  #acquireLock() {
    const startedAt = Date.now();
    while (true) {
      try {
        const lock = {
          fd: fs.openSync(this.lockPath, 'wx', 0o600),
          id: `${process.pid}:${crypto.randomBytes(8).toString('hex')}`
        };
        try {
          fs.writeFileSync(lock.fd, lock.id);
          return lock;
        } catch (err) {
          try {
            fs.closeSync(lock.fd);
          } finally {
            try {
              fs.unlinkSync(this.lockPath);
            } catch {}
          }
          throw err;
        }
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
        if (this.#breakStaleLock()) continue;
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new Error(`timed out waiting for reply token lock: ${this.lockPath}`);
        }
        sleepSync(LOCK_RETRY_MS);
      }
    }
  }

  #breakStaleLock() {
    try {
      const stat = fs.statSync(this.lockPath);
      if (Date.now() - stat.mtimeMs < this.staleLockMs) return false;
      fs.unlinkSync(this.lockPath);
      return true;
    } catch (err) {
      if (err?.code === 'ENOENT') return true;
      throw err;
    }
  }

  #releaseLock(lockId) {
    try {
      if (fs.readFileSync(this.lockPath, 'utf8') !== lockId) return;
      fs.unlinkSync(this.lockPath);
    } catch {}
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
