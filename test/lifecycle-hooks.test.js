import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'line-home-'));
}

function runtimePaths(home) {
  const dataDir = path.join(home, 'zylos/components/line');
  return {
    dataDir,
    configPath: path.join(dataDir, 'config.json'),
    logsDir: path.join(dataDir, 'logs'),
    mediaDir: path.join(dataDir, 'media')
  };
}

function runScript(script, { home = tempHome(), input = '' } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(ROOT, script)], {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: home
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr, home }));
    child.stdin.end(input);
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('lifecycle hooks', () => {
  it('post-install creates safe default config plus logs and media dirs', async () => {
    const home = tempHome();
    const paths = runtimePaths(home);

    const result = await runScript('hooks/post-install.js', { home });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[post-install] Created');
    expect(fs.existsSync(paths.configPath)).toBe(true);
    expect(fs.existsSync(paths.logsDir)).toBe(true);
    expect(fs.existsSync(paths.mediaDir)).toBe(true);

    const stat = fs.statSync(paths.configPath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(readJson(paths.configPath)).toEqual(expect.objectContaining({
      enabled: true,
      dmPolicy: 'owner',
      groupPolicy: 'allowlist',
      mediaMaxMb: 10,
      requestMaxBytes: '1mb',
      channelAccessToken: '',
      channelSecret: ''
    }));
  });

  it('post-install preserves existing config values', async () => {
    const home = tempHome();
    const paths = runtimePaths(home);
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(paths.configPath, JSON.stringify({
      enabled: true,
      channelAccessToken: 'existing-token',
      channelSecret: 'existing-secret',
      webhookPath: '/line/custom'
    }), { mode: 0o600 });

    const result = await runScript('hooks/post-install.js', { home });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Existing config preserved');
    expect(readJson(paths.configPath)).toEqual({
      enabled: true,
      channelAccessToken: 'existing-token',
      channelSecret: 'existing-secret',
      webhookPath: '/line/custom'
    });
    expect(fs.existsSync(paths.logsDir)).toBe(true);
    expect(fs.existsSync(paths.mediaDir)).toBe(true);
  });

  it('post-upgrade creates runtime dirs without rewriting config', async () => {
    const home = tempHome();
    const paths = runtimePaths(home);
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.writeFileSync(paths.configPath, '{"sentinel":true}', { mode: 0o600 });

    const result = await runScript('hooks/post-upgrade.js', { home });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('upgrade complete');
    expect(readJson(paths.configPath)).toEqual({ sentinel: true });
    expect(fs.existsSync(paths.logsDir)).toBe(true);
    expect(fs.existsSync(paths.mediaDir)).toBe(true);
  });

  it('configure merges collected credentials into existing config and keeps defaults safe', async () => {
    const home = tempHome();
    const paths = runtimePaths(home);
    await runScript('hooks/post-install.js', { home });

    const result = await runScript('hooks/configure.js', {
      home,
      input: JSON.stringify({
        LINE_CHANNEL_ACCESS_TOKEN: 'token',
        LINE_CHANNEL_SECRET: 'secret',
        LINE_WEBHOOK_PATH: '/line/webhook/local'
      })
    });

    expect(result.code).toBe(0);
    expect(readJson(paths.configPath)).toEqual(expect.objectContaining({
      channelAccessToken: 'token',
      channelSecret: 'secret',
      webhookPath: '/line/webhook/local',
      dmPolicy: 'owner',
      groupPolicy: 'allowlist',
      mediaMaxMb: 10,
      requestMaxBytes: '1mb'
    }));
    expect(fs.statSync(paths.configPath).mode & 0o777).toBe(0o600);
  });

  it('configure fails closed on missing stdin JSON', async () => {
    const home = tempHome();
    const paths = runtimePaths(home);

    const result = await runScript('hooks/configure.js', { home });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Expected stdin JSON object');
    expect(fs.existsSync(paths.configPath)).toBe(false);
  });
});
