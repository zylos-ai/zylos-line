#!/usr/bin/env node
/**
 * Local admin CLI for zylos-line access control.
 *
 * Examples:
 *   node scripts/admin.js status
 *   node scripts/admin.js dm-allow add U123
 *   node scripts/admin.js group add C123 U123
 *   node scripts/admin.js pairing approve U123
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { runAdminCommand } from '../src/lib/admin.js';

dotenv.config({ path: path.join(process.env.HOME || '', 'zylos/.env') });

function usage() {
  return [
    'Usage:',
    '  admin.js status',
    '  admin.js owner bind <UuserId> [name] [--force]',
    '  admin.js policy dm <open|allowlist|owner|pairing|disabled>',
    '  admin.js policy group <open|allowlist|disabled>',
    '  admin.js dm-allow add <UuserId>',
    '  admin.js dm-allow remove <UuserId> [--confirm-empty]',
    '  admin.js group add <CgroupId|RroomId> (--allow-all | <UuserId>...)',
    '  admin.js group remove-user <CgroupId|RroomId> <UuserId> [--confirm-empty]',
    '  admin.js pairing list',
    '  admin.js pairing approve <UuserId>',
    '  admin.js pairing deny <UuserId>'
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    console.log(usage());
    return 0;
  }

  try {
    const result = runAdminCommand(argv, deps);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().then(code => process.exit(code));
}
