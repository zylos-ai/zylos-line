import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplyTokenStore } from '../src/lib/reply-token-store.js';

const WORKER_CODE = `
import fs from 'node:fs';
const { ReplyTokenStore } = await import(process.env.STORE_URL);
const args = JSON.parse(process.env.WORKER_ARGS);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

while (!fs.existsSync(args.startFile)) {
  sleepSync(5);
}

const store = new ReplyTokenStore({
  filePath: args.filePath,
  now: () => 1000,
  lockTimeoutMs: 5000,
  staleLockMs: 5000
});

if (args.op === 'consume') {
  const entry = store.consume(args.key);
  if (!entry) throw new Error('expected consume to return an entry');
} else if (args.op === 'createMany') {
  const keys = [];
  for (let index = 0; index < args.count; index += 1) {
    keys.push(store.create({
      accountId: 'default',
      targetId: args.targetId,
      replyToken: args.replyPrefix + index,
      ttlMs: 60_000
    }));
  }
  fs.writeFileSync(args.outFile, JSON.stringify(keys));
} else {
  throw new Error('unknown op');
}
`;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', WORKER_CODE], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        STORE_URL: pathToFileURL(path.resolve('src/lib/reply-token-store.js')).href,
        WORKER_ARGS: JSON.stringify(args)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`worker exited ${code}: ${stderr}`));
      }
    });
  });
}

describe('reply token store concurrency', () => {
  it('serializes concurrent create and consume transactions across processes', async () => {
    const dir = tempDir('line-reply-concurrency-');
    const filePath = path.join(dir, 'reply.json');
    const startFile = path.join(dir, 'start');
    const store = new ReplyTokenStore({ filePath, now: () => 1000 });
    const consumedKey = store.create({
      accountId: 'default',
      targetId: 'U-consumed',
      replyToken: 'consume-me',
      ttlMs: 60_000
    });

    const creators = Array.from({ length: 8 }, (_, workerIndex) => {
      const outFile = path.join(dir, `created-${workerIndex}.json`);
      return {
        outFile,
        promise: runWorker({
          op: 'createMany',
          filePath,
          startFile,
          outFile,
          targetId: `U-created-${workerIndex}`,
          replyPrefix: `created-${workerIndex}-`,
          count: 10
        })
      };
    });
    const consumer = runWorker({ op: 'consume', filePath, startFile, key: consumedKey });

    fs.writeFileSync(startFile, 'go');

    await expect(Promise.all([consumer, ...creators.map(worker => worker.promise)])).resolves.toBeDefined();

    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(state[consumedKey].consumed).toBe(true);
    expect(fs.existsSync(`${filePath}.lock`)).toBe(false);

    const createdKeys = creators.flatMap(worker => JSON.parse(fs.readFileSync(worker.outFile, 'utf8')));
    expect(createdKeys).toHaveLength(80);
    for (const key of createdKeys) {
      expect(state[key]).toEqual(expect.objectContaining({ consumed: false }));
    }
  });

  it('recovers stale locks and releases the replacement lock', () => {
    const dir = tempDir('line-reply-stale-lock-');
    const filePath = path.join(dir, 'reply.json');
    const lockPath = `${filePath}.lock`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(lockPath, 'dead-holder');
    const oldTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, oldTime, oldTime);

    const store = new ReplyTokenStore({
      filePath,
      now: () => 1000,
      lockTimeoutMs: 500,
      staleLockMs: 10
    });
    const key = store.create({
      accountId: 'default',
      targetId: 'U123',
      replyToken: 'raw-reply-token',
      ttlMs: 60_000
    });

    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(state[key]).toEqual(expect.objectContaining({ replyToken: 'raw-reply-token' }));
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('serializes concurrent stale-lock recovery across processes', async () => {
    const dir = tempDir('line-reply-stale-lock-concurrency-');
    const filePath = path.join(dir, 'reply.json');
    const lockPath = `${filePath}.lock`;
    const startFile = path.join(dir, 'start');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(lockPath, 'dead-holder');
    const oldTime = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, oldTime, oldTime);

    const creators = Array.from({ length: 8 }, (_, workerIndex) => {
      const outFile = path.join(dir, `created-stale-${workerIndex}.json`);
      return {
        outFile,
        promise: runWorker({
          op: 'createMany',
          filePath,
          startFile,
          outFile,
          targetId: `U-stale-${workerIndex}`,
          replyPrefix: `stale-${workerIndex}-`,
          count: 10
        })
      };
    });

    fs.writeFileSync(startFile, 'go');

    await expect(Promise.all(creators.map(worker => worker.promise))).resolves.toBeDefined();

    const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const createdKeys = creators.flatMap(worker => JSON.parse(fs.readFileSync(worker.outFile, 'utf8')));
    expect(createdKeys).toHaveLength(80);
    for (const key of createdKeys) {
      expect(state[key]).toEqual(expect.objectContaining({ consumed: false }));
    }
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(`${lockPath}.break`)).toBe(false);
  });
});
