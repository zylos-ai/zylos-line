import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'line-admin-cli-'));
}

function configPath(home) {
  return path.join(home, 'zylos/components/line/config.json');
}

function runAdmin(home, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/admin.js', ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

describe('admin CLI entrypoint', () => {
  it('prints redacted status and exits nonzero on invalid mutation', async () => {
    const home = tempHome();
    const filePath = configPath(home);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      enabled: true,
      channelAccessToken: 'secret-token',
      channelSecret: 'secret-value',
      dmPolicy: 'owner',
      groupPolicy: 'allowlist',
      owner: { bound: true, userId: 'Uowner', name: 'Owner' }
    }), { mode: 0o600 });

    const status = await runAdmin(home, ['status']);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual(expect.objectContaining({
      hasDefaultCredentials: true,
      dmPolicy: 'owner',
      groupPolicy: 'allowlist'
    }));
    expect(status.stdout).not.toContain('secret-token');
    expect(status.stdout).not.toContain('secret-value');

    const invalid = await runAdmin(home, ['dm-allow', 'add', '__proto__']);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('invalid LINE user ID');
  });
});
