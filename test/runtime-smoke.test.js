import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'line-runtime-'));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(err => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}`)), 5000);
    const onData = chunk => {
      output += chunk.toString();
      if (pattern.test(output)) {
        clearTimeout(timer);
        resolve(output);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Runtime exited before ready: ${code}\n${output}`));
    });
  });
}

function stop(child) {
  return new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}

describe('runtime smoke', () => {
  it('starts the service and exposes safe health metadata', async () => {
    const home = tempHome();
    const port = await freePort();
    const dataDir = path.join(home, 'zylos/components/line');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
      enabled: true,
      port,
      channelAccessToken: 'smoke-token',
      channelSecret: 'smoke-secret'
    }), { mode: 0o600 });

    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    try {
      await waitForOutput(child, /Listening on 127\.0\.0\.1:/);
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(expect.objectContaining({
        status: 'ok',
        service: 'zylos-line',
        enabled: true,
        accountCount: 1,
        hasDefaultCredentials: true,
        dmPolicy: 'owner',
        groupPolicy: 'allowlist'
      }));
      expect(JSON.stringify(body)).not.toContain('smoke-token');
      expect(JSON.stringify(body)).not.toContain('smoke-secret');
      expect(fs.existsSync(path.join(dataDir, 'logs'))).toBe(true);
      expect(fs.existsSync(path.join(dataDir, 'media'))).toBe(true);
      expect(fs.existsSync(path.join(dataDir, '.internal-token'))).toBe(true);
    } finally {
      await stop(child);
    }
  });
});
