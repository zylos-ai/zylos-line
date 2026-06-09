#!/usr/bin/env node
import fs from 'node:fs';
import { CONFIG_PATH, DEFAULT_CONFIG, ensureRuntimeDirs, saveConfig } from '../src/lib/config.js';

ensureRuntimeDirs();
if (!fs.existsSync(CONFIG_PATH)) {
  saveConfig(DEFAULT_CONFIG);
  console.log(`[post-install] Created ${CONFIG_PATH}`);
} else {
  console.log('[post-install] Existing config preserved');
}
