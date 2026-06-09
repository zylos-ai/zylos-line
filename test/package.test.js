import { execFile } from 'node:child_process';
import fs from 'node:fs';
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
  });

  it('packs only intended runtime files and no tests or local artifacts', async () => {
    const [pack] = await execJson('npm', ['pack', '--dry-run', '--json']);
    const files = pack.files.map(file => file.path).sort();

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
});
