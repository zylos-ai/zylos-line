import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { parseC4Response } from './format.js';
import { sessionGroupFromEndpoint } from './session-group.js';

export const DEFAULT_C4_RECEIVE = path.join(
  process.env.HOME || '',
  'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js'
);

export const GENERIC_REJECT_REPLY = "Sorry, I couldn't take this message right now. Please try again later.";
export const UNCERTAIN_REPLY = "Sorry, this message may not have reached me. If you don't get a reply in a few minutes, please send it again.";

/**
 * Whether the installed Core lists an optional c4-receive argument.
 * Reads `c4-receive-options.json` beside the c4-receive script on every call,
 * so a Core upgrade needs no restart. Missing or unreadable files, invalid
 * JSON and invalid shapes all mean unsupported.
 */
export function c4ReceiveSupportsOption(c4Receive, name) {
  try {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(path.dirname(c4Receive), 'c4-receive-options.json'), 'utf8'));
    return manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)
      && manifest.options !== null && typeof manifest.options === 'object'
      && !Array.isArray(manifest.options) && Object.hasOwn(manifest.options, name);
  } catch {
    return false;
  }
}

export function buildC4ReceiveArgs({ c4Receive, source, endpoint, content, sessionGroup }) {
  const args = [c4Receive, '--channel', source, '--endpoint', endpoint, '--json', '--content', content];
  if (sessionGroup != null && sessionGroup !== '' && c4ReceiveSupportsOption(c4Receive, '--session-group')) {
    args.push('--session-group', sessionGroup);
  }
  return args;
}

/**
 * Classify a structured c4-receive rejection by `error.persisted`:
 * non-empty array -> 'committed' (stored; send nothing, do not resend),
 * empty array -> 'not_stored', anything else -> 'uncertain'.
 */
export function classifyC4Rejection(response) {
  const persisted = response?.error?.persisted;
  if (!Array.isArray(persisted)) return 'uncertain';
  return persisted.length > 0 ? 'committed' : 'not_stored';
}

/**
 * True when c4-receive never started (spawn itself failed), so Core cannot
 * have stored anything. Any other failure without a structured result has an
 * unknown outcome.
 */
function neverStarted(error) {
  return typeof error?.code === 'string'
    && typeof error.syscall === 'string' && error.syscall.startsWith('spawn');
}

export function createC4Sender({
  c4Receive = DEFAULT_C4_RECEIVE,
  execFileImpl = execFile,
  retryDelayMs = 2000,
  logger = console
} = {}) {
  const run = (args) => new Promise((resolve) => {
    execFileImpl('node', args, { encoding: 'utf8' }, (error, stdout) => resolve({ error, stdout }));
  });

  /**
   * Send one inbound message to Core via c4-receive.
   *
   * The session group is derived only when the installed Core lists
   * --session-group, so older Cores get exactly the same arguments as before.
   * An endpoint that cannot be mapped is not sent: it never falls back to the
   * overall group. Core's error text only goes to the log.
   *
   * c4-receive runs without a timeout: Core may still be routing the message
   * or sending a status notice after storing it, and it has no inbound
   * idempotency key. A call that is stored or whose outcome is unknown is never
   * retried; only a call that never started is retried once.
   *
   * @param {object} [callbacks]
   * @param {(text: string) => void} [callbacks.onNotice] - called with the text
   *   to send the LINE user when the agent will not answer this message
   * @returns {Promise<'sent'|'committed'|'not_stored'|'uncertain'|undefined>}
   */
  return async function sendToC4(source, endpoint, content, { onNotice } = {}) {
    if (!content) {
      logger.error('[line] sendToC4 called with empty content');
      return undefined;
    }

    const notify = (outcome, text) => {
      if (onNotice) onNotice(text);
      return outcome;
    };

    let sessionGroup;
    if (c4ReceiveSupportsOption(c4Receive, '--session-group')) {
      try {
        sessionGroup = sessionGroupFromEndpoint(endpoint);
      } catch (err) {
        logger.error(`[line] No session group for ${endpoint}, not sent: ${err.message}`);
        return notify('not_stored', GENERIC_REJECT_REPLY);
      }
    }

    for (let attempt = 1; ; attempt += 1) {
      const args = buildC4ReceiveArgs({ c4Receive, source, endpoint, content, sessionGroup });
      const { error, stdout } = await run(args);
      const response = parseC4Response(error?.stdout || stdout);

      if (response && response.ok === false && response.error) {
        const kind = classifyC4Rejection(response);
        const { code, message } = response.error;
        if (kind === 'committed') {
          logger.warn(`[line] C4 rejected after commit (${code}), not resending: ${message}`);
          return 'committed';
        }
        logger.warn(`[line] C4 rejected (${code}, ${kind}) [group=${sessionGroup ?? ''}]: ${message}`);
        return notify(kind, kind === 'not_stored' ? GENERIC_REJECT_REPLY : UNCERTAIN_REPLY);
      }

      if (!error) {
        logger.log(`[line] Sent to C4: ${content.substring(0, 50)}...`);
        return 'sent';
      }

      if (!neverStarted(error) || attempt >= 2) {
        logger.error(`[line] C4 send failed, outcome unknown, not resending: ${error.message}`);
        return notify('uncertain', UNCERTAIN_REPLY);
      }

      logger.warn(`[line] C4 receive did not start, retrying in ${retryDelayMs / 1000}s: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  };
}

export const sendToC4 = createC4Sender();
