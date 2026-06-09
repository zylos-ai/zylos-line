import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventDedupeStore } from '../src/lib/event-dedupe.js';

describe('event dedupe store', () => {
  it('uses process-local state as primary and persists mutations to disk', () => {
    let now = 1000;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-dedupe-'));
    const filePath = path.join(dir, 'dedupe.json');
    const store = new EventDedupeStore({ filePath, now: () => now, ttlMs: 60_000 });

    expect(store.seen('default', 'evt-1')).toBe(false);
    fs.writeFileSync(filePath, '{}');

    expect(store.seen('default', 'evt-1')).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))['default:evt-1']).toBeGreaterThan(now);
  });

  it('expires old event ids', () => {
    let now = 1000;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-dedupe-'));
    const store = new EventDedupeStore({ filePath: path.join(dir, 'dedupe.json'), now: () => now, ttlMs: 10 });

    expect(store.seen('default', 'evt-1')).toBe(false);
    expect(store.seen('default', 'evt-1')).toBe(true);

    now = 1011;
    expect(store.seen('default', 'evt-1')).toBe(false);
  });
});
