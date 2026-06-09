import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPairingState, markPairingPending, savePairingState } from '../src/lib/dm-pairing.js';

describe('LINE DM pairing state', () => {
  it('loads missing state as empty', () => {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'line-pairing-')), 'missing.json');

    expect(loadPairingState(filePath)).toEqual({ pending: {}, denied: {} });
  });

  it('throws on malformed state so callers can fail closed', () => {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'line-pairing-')), 'pairing.json');
    fs.writeFileSync(filePath, '{bad json');

    expect(() => loadPairingState(filePath)).toThrow();
  });

  it('persists pending pairing requests', () => {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'line-pairing-')), 'pairing.json');
    const state = { pending: {}, denied: {} };

    markPairingPending({ userId: 'Unew', userName: 'User', conversationId: 'Unew', firstMessage: 'hello' }, state);
    savePairingState(state, filePath);

    expect(loadPairingState(filePath).pending.Unew).toEqual(expect.objectContaining({ firstMessage: 'hello' }));
  });
});
