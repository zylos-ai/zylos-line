import { describe, expect, it } from 'vitest';
import { computeLineSignature, verifyLineSignature } from '../src/lib/signature.js';

describe('LINE signature verification', () => {
  it('verifies HMAC-SHA256 over the exact raw body bytes', () => {
    const raw = Buffer.from('{"destination":"U123","events":[]}\n');
    const secret = 'channel-secret';
    const signature = computeLineSignature(raw, secret);

    expect(verifyLineSignature(raw, signature, secret)).toBe(true);
    expect(verifyLineSignature(Buffer.from(raw.toString().trim()), signature, secret)).toBe(false);
  });

  it('rejects missing, tampered, and wrong-secret signatures', () => {
    const raw = Buffer.from('{"events":[]}');
    const signature = computeLineSignature(raw, 'good-secret');

    expect(verifyLineSignature(raw, '', 'good-secret')).toBe(false);
    expect(verifyLineSignature(raw, signature, 'bad-secret')).toBe(false);
    expect(verifyLineSignature(Buffer.from('{"events":[1]}'), signature, 'good-secret')).toBe(false);
  });
});
