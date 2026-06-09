#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, CONFIG_PATH, DEFAULT_CONFIG, saveConfig } from '../src/lib/config.js';

fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
if (!fs.existsSync(CONFIG_PATH)) {
  saveConfig(DEFAULT_CONFIG);
  console.log(`[post-install] Created ${CONFIG_PATH}`);
} else {
  console.log('[post-install] Existing config preserved');
}
