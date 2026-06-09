#!/usr/bin/env node
import fs from 'node:fs';
import { CONFIG_PATH, DEFAULT_CONFIG, saveConfig } from '../src/lib/config.js';

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

try {
  const raw = (await readStdin()).trim();
  if (!raw) throw new Error('Expected stdin JSON object with collected config values');
  const collected = JSON.parse(raw);
  const config = readExisting();

  if (collected.LINE_CHANNEL_ACCESS_TOKEN) config.channelAccessToken = collected.LINE_CHANNEL_ACCESS_TOKEN;
  if (collected.LINE_CHANNEL_SECRET) config.channelSecret = collected.LINE_CHANNEL_SECRET;
  if (collected.LINE_WEBHOOK_PATH) config.webhookPath = collected.LINE_WEBHOOK_PATH;

  saveConfig(config);
  console.log(`[configure] Config written to ${CONFIG_PATH}`);
} catch (err) {
  console.error(`[configure] ${err.message}`);
  process.exit(1);
}
