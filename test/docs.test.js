import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/lib/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readDoc(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

describe('release documentation', () => {
  it('documents security-sensitive defaults in parity with DEFAULT_CONFIG', () => {
    const readme = readDoc('README.md');

    expect(readme).toContain(`| \`dmPolicy\` | \`${DEFAULT_CONFIG.dmPolicy}\` |`);
    expect(readme).toContain(`| \`groupPolicy\` | \`${DEFAULT_CONFIG.groupPolicy}\` |`);
    expect(readme).toContain(`| \`mediaMaxMb\` | \`${DEFAULT_CONFIG.mediaMaxMb}\` |`);
    expect(readme).toContain(`| \`requestMaxBytes\` | \`${DEFAULT_CONFIG.requestMaxBytes}\` |`);
    expect(readme).toContain('Configured group/room `allowFrom: []` means allow all senders');
    expect(readme).toContain('Signature verification is always required');
    expect(readme).toContain('127.0.0.1');
  });

  it('uses placeholders instead of project test secrets in docs', () => {
    const docs = `${readDoc('README.md')}\n${readDoc('DESIGN.md')}`;

    expect(docs).toContain('YOUR_CHANNEL_ACCESS_TOKEN');
    expect(docs).toContain('YOUR_CHANNEL_SECRET');
    expect(docs).not.toMatch(/secret-token|secret-value|root-token|root-secret|alt-token|alt-secret|raw-reply-token/);
    expect(docs).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/);
  });
});
