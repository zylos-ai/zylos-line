#!/usr/bin/env node
/**
 * C4 Communication Bridge Interface for zylos-line.
 *
 * Usage:
 *   node scripts/send.js <endpoint> "message text"
 *   echo "message text" | node scripts/send.js <endpoint>
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { findAccountById, getConfig } from '../src/lib/config.js';
import { parseEndpoint } from '../src/lib/format.js';
import { ReplyTokenStore } from '../src/lib/reply-token-store.js';
import { sendPushMessage, sendReplyMessage } from '../src/lib/line-api.js';
import { batchMessages, LINE_MAX_MESSAGES_PER_REQUEST, toTextMessages } from '../src/lib/text-split.js';

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

async function sendPushBatches({ account, targetId, batches, sendPush = sendPushMessage }) {
  const results = [];
  for (const messages of batches) {
    results.push(await sendPush({
      channelAccessToken: account.channelAccessToken,
      to: targetId,
      messages
    }));
  }
  return results;
}

export async function sendContent(endpoint, content, {
  config = getConfig(),
  replyTokenStore = new ReplyTokenStore(),
  sendReply = sendReplyMessage,
  sendPush = sendPushMessage
} = {}) {
  const message = String(content ?? '');
  if (message.trim() === '[SKIP]') return [];
  if (!config.enabled) throw new Error('line is disabled in config');

  const parsedEndpoint = parseEndpoint(endpoint);
  if (!parsedEndpoint.targetId) throw new Error('missing LINE endpoint target');

  const account = findAccountById(parsedEndpoint.account, config);
  if (!account) throw new Error(`unknown LINE account: ${parsedEndpoint.account}`);
  if (!account.channelAccessToken) throw new Error(`missing channelAccessToken for LINE account: ${account.id}`);

  const messages = toTextMessages(message);
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
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().then(code => process.exit(code));
}
