import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPairingNotification, loadPairingState, markPairingPending, savePairingState } from '../src/lib/dm-pairing.js';

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

  it('prints real admin CLI approve and deny commands in pairing notifications', () => {
    const notification = buildPairingNotification({
      userId: 'Unew',
      userName: 'User',
      conversationId: 'Unew',
      firstMessage: 'hello'
    });

    expect(notification).toContain('Approve: node scripts/admin.js pairing approve Unew');
    expect(notification).toContain('Deny: node scripts/admin.js pairing deny Unew');
  });
});
