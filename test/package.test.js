import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function execJson(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: ROOT, encoding: 'utf8', timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

function execResult(command, args, options = {}) {
  return new Promise(resolve => {
    execFile(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
      ...options
    }, (error, stdout, stderr) => {
      resolve({
        code: error?.code ?? 0,
        stdout,
        stderr
      });
    });
  });
}

describe('package release metadata', () => {
  it('declares stable CLI bins and matching lockfile metadata', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

    expect(pkg.bin).toEqual({
      'zylos-line-send': './scripts/send.js',
      'zylos-line-admin': './scripts/admin.js'
    });
    expect(lock.packages[''].bin).toEqual({
      'zylos-line-send': 'scripts/send.js',
      'zylos-line-admin': 'scripts/admin.js'
    });
    expect(fs.statSync(path.join(ROOT, 'scripts/send.js')).mode & 0o111).not.toBe(0);
    expect(fs.statSync(path.join(ROOT, 'scripts/admin.js')).mode & 0o111).not.toBe(0);
  });

  it('declares zylos installer metadata for declarative install', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');

    expect(pkg.files).toContain('SKILL.md');
    expect(skill).toContain('name: line');
    expect(skill).toContain('type: communication');
    expect(skill).toContain('npm: true');
    expect(skill).toContain('entry: src/index.js');
    expect(skill).toContain('configure: hooks/configure.js');
    expect(skill).toContain('post-install: hooks/post-install.js');
    expect(skill).toContain('zylos-line-send: scripts/send.js');
    expect(skill).toContain('zylos-line-admin: scripts/admin.js');
    expect(skill).toContain('LINE_CHANNEL_ACCESS_TOKEN');
    expect(skill).toContain('LINE_CHANNEL_SECRET');
  });

  it('packs only intended runtime files and no tests or local artifacts', async () => {
    const [pack] = await execJson('npm', ['pack', '--dry-run', '--json']);
    const files = pack.files.map(file => file.path).sort();

    expect(files).toContain('SKILL.md');
    expect(files).toContain('CHANGELOG.md');
    expect(files).toContain('scripts/send.js');
    expect(files).toContain('scripts/admin.js');
    expect(files).toContain('src/lib/admin.js');
    expect(files).toContain('src/lib/media.js');
    expect(files).toContain('README.md');
    expect(files).toContain('DESIGN.md');
    expect(files.some(file => file.startsWith('test/'))).toBe(false);
    expect(files.some(file => file.includes('node_modules'))).toBe(false);
    expect(files.some(file => file.includes('media/'))).toBe(false);
    expect(files.some(file => file.includes('logs/'))).toBe(false);
    expect(files.some(file => file.includes('line-admin-cli-'))).toBe(false);
  });

  it('installed package bins execute through npm .bin symlinks', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'line-package-bin-'));
    const prefix = path.join(temp, 'prefix');
    const home = path.join(temp, 'home');
    fs.mkdirSync(home, { recursive: true });

    const install = await execResult('npm', ['install', '--prefix', prefix, ROOT]);
    expect(install.code).toBe(0);

    const binDir = path.join(prefix, 'node_modules/.bin');
    const admin = await execResult(path.join(binDir, 'zylos-line-admin'), ['status'], {
      env: { ...process.env, HOME: home }
    });
    expect(admin.code).toBe(0);
    expect(JSON.parse(admin.stdout)).toEqual(expect.objectContaining({
      dmPolicy: 'owner',
      groupPolicy: 'allowlist',
      hasDefaultCredentials: false
    }));

    const send = await execResult(path.join(binDir, 'zylos-line-send'), [], {
      env: { ...process.env, HOME: home }
    });
    expect(send.code).toBe(1);
    expect(send.stderr).toContain('Usage: send.js <endpoint> <message>');
  });
});
