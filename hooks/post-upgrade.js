#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../src/lib/config.js';

fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
console.log('[post-upgrade] zylos-line upgrade complete');
