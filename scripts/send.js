#!/usr/bin/env node
/**
 * C4 Communication Bridge Interface for zylos-line.
 *
 * Usage:
 *   node scripts/send.js <endpoint> "message text"
 *   echo "message text" | node scripts/send.js <endpoint>
 */

import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { findAccountById, getConfig } from '../src/lib/config.js';
import { parseEndpoint } from '../src/lib/format.js';
import { ReplyTokenStore } from '../src/lib/reply-token-store.js';
import { sendPushMessage, sendReplyMessage } from '../src/lib/line-api.js';
import { batchMessages, LINE_MAX_MESSAGES_PER_REQUEST, toTextMessages } from '../src/lib/text-split.js';
import { validatePublicMediaUrl } from '../src/lib/media.js';

dotenv.config({ path: path.join(process.env.HOME || '', 'zylos/.env') });

function usage() {
  console.error('Usage: send.js <endpoint> <message>');
}

export function readStdin(stdin = process.stdin) {
  return new Promise((resolve, reject) => {
    let data = '';
    stdin.setEncoding('utf8');
    stdin.on('data', chunk => {
      data += chunk;
    });
    stdin.on('error', reject);
    stdin.on('end', () => resolve(data));
  });
}

function validReplyEntry(entry, parsedEndpoint) {
  return Boolean(
    entry
    && entry.accountId === parsedEndpoint.account
    && entry.targetId === parsedEndpoint.targetId
    && entry.replyToken
  );
}

function isReplyTokenFailure(err) {
  return err?.status === 400 && /reply\s*token/i.test(String(err.message || ''));
}

const MEDIA_MARKER_RE = /^\[MEDIA:(image|video|audio)]\s*(\S+)(?:\s+(\S+))?\s*$/i;

export async function toLineMessages(content, { config, validateMedia = validatePublicMediaUrl } = {}) {
  const lines = String(content ?? '').split(/\r?\n/);
  const messages = [];
  let textBuffer = [];

  const flushText = () => {
    const text = textBuffer.join('\n').trim();
    if (text) messages.push(...toTextMessages(text));
    textBuffer = [];
  };

  for (const line of lines) {
    const marker = line.match(MEDIA_MARKER_RE);
    if (!marker) {
      textBuffer.push(line);
      continue;
    }

    flushText();
    const mediaType = marker[1].toLowerCase();
    const original = await validateMedia(marker[2], { mediaType, config });
    if (mediaType === 'image') {
      messages.push({
        type: 'image',
        originalContentUrl: original.url,
        previewImageUrl: original.url
      });
    } else if (mediaType === 'video') {
      if (!marker[3]) throw new Error('[MEDIA:video] requires a preview image URL');
      const preview = await validateMedia(marker[3], { mediaType: 'image', config });
      messages.push({
        type: 'video',
        originalContentUrl: original.url,
        previewImageUrl: preview.url
      });
    } else if (mediaType === 'audio') {
      const duration = marker[3] ? Number(marker[3]) : 60_000;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('[MEDIA:audio] duration must be a positive number');
      messages.push({
        type: 'audio',
        originalContentUrl: original.url,
        duration
      });
    }
  }

  flushText();
  return messages;
}

async function sendPushBatches({ account, targetId, batches, sendPush = sendPushMessage }) {
  const results = [];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const messages = batches[batchIndex];
    results.push(await sendPush({
      channelAccessToken: account.channelAccessToken,
      to: targetId,
      messages,
      retryKey: deterministicRetryKey({ accountId: account.id, targetId, messages, batchIndex })
    }));
  }
  return results;
}

export function deterministicRetryKey({ accountId, targetId, messages, batchIndex }) {
  const bytes = crypto.createHash('sha256')
    .update(JSON.stringify({ accountId, targetId, messages, batchIndex }))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hash = bytes.toString('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join('-');
}

export async function sendContent(endpoint, content, {
  config = getConfig(),
  replyTokenStore = new ReplyTokenStore(),
  sendReply = sendReplyMessage,
  sendPush = sendPushMessage,
  validateMedia = validatePublicMediaUrl
} = {}) {
  const message = String(content ?? '');
  if (message.trim() === '[SKIP]') return [];
  if (!config.enabled) throw new Error('line is disabled in config');

  const parsedEndpoint = parseEndpoint(endpoint);
  if (!parsedEndpoint.targetId) throw new Error('missing LINE endpoint target');

  const account = findAccountById(parsedEndpoint.account, config);
  if (!account) throw new Error(`unknown LINE account: ${parsedEndpoint.account}`);
  if (!account.channelAccessToken) throw new Error(`missing channelAccessToken for LINE account: ${account.id}`);

  const messages = await toLineMessages(message, { config, validateMedia });
  if (messages.length === 0) return [];
  const results = [];
  let startPushAt = 0;

  if (parsedEndpoint.replyKey) {
    const entry = replyTokenStore.consume(parsedEndpoint.replyKey);
    if (validReplyEntry(entry, parsedEndpoint)) {
      const replyMessages = messages.slice(0, LINE_MAX_MESSAGES_PER_REQUEST);
      try {
        results.push(await sendReply({
          channelAccessToken: account.channelAccessToken,
          replyToken: entry.replyToken,
          messages: replyMessages
        }));
        startPushAt = replyMessages.length;
      } catch (err) {
        if (!isReplyTokenFailure(err)) throw err;
      }
    }
  }

  const pushMessages = messages.slice(startPushAt);
  if (pushMessages.length > 0) {
    results.push(...await sendPushBatches({
      account,
      targetId: parsedEndpoint.targetId,
      batches: batchMessages(pushMessages),
      sendPush
    }));
  }
  return results;
}

export async function main(argv = process.argv.slice(2), stdin = process.stdin, deps = {}) {
  if (argv.length < 1) {
    usage();
    return 1;
  }

  const endpoint = argv[0];
  const content = argv.length > 1 ? argv.slice(1).join(' ') : await readStdin(stdin);
  try {
    await sendContent(endpoint, content, deps);
    console.log('Message sent successfully');
    return 0;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 1;
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === thisFile) {
  main().then(code => process.exit(code));
}
