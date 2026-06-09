import express from 'express';
import { findAccountByPath, getAccounts, getConfig } from './lib/config.js';
import { verifyLineSignature } from './lib/signature.js';
import { EventDedupeStore } from './lib/event-dedupe.js';
import { ReplyTokenStore } from './lib/reply-token-store.js';
import { buildEndpoint, formatMessage, lineSourceType, lineTargetId } from './lib/format.js';
import { decideInboundAccess } from './lib/access.js';

function requestPath(req) {
  return req.path || req.originalUrl?.split('?')[0] || '';
}

function safeJsonParse(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}

function eventText(event) {
  if (event.type !== 'message') return '';
  if (event.message?.type === 'text') return event.message.text || '';
  return '';
}

export function registerRoutes(app, deps = {}) {
  const {
    internalToken = '',
    sendToC4 = () => {},
    replyTokenStore = new ReplyTokenStore(),
    eventDedupeStore = new EventDedupeStore({ ttlMs: getConfig().webhookDedupTtlMs }),
    decideAccess = decideInboundAccess,
    logger = console
  } = deps;

  app.get('/health', (req, res) => {
    const cfg = getConfig();
    let accounts = [];
    try {
      accounts = getAccounts(cfg);
    } catch (err) {
      return res.status(500).json({ status: 'error', error: err.message });
    }
    res.json({
      status: 'ok',
      service: 'zylos-line',
      uptime: Math.floor(process.uptime()),
      enabled: !!cfg.enabled,
      accountCount: accounts.length,
      hasDefaultCredentials: !!(cfg.channelAccessToken && cfg.channelSecret),
      dmPolicy: cfg.dmPolicy || 'owner',
      groupPolicy: cfg.groupPolicy || 'allowlist'
    });
  });

  app.use('/internal/record-outgoing', express.json());
  app.post('/internal/record-outgoing', (req, res) => {
    if (!internalToken || req.headers['x-internal-token'] !== internalToken) {
      return res.status(403).json({ error: 'unauthorized' });
    }
    res.json({ ok: true });
  });

  for (const account of getAccounts()) {
    app.get(account.webhookPath, (req, res) => {
      res.json({
        ok: true,
        service: 'zylos-line',
        accountId: account.id,
        note: 'LINE verification uses signed POST with events:[]; GET is health-only.'
      });
    });

    app.post(account.webhookPath, express.raw({ type: '*/*', limit: getConfig().requestMaxBytes }), async (req, res) => {
      const cfg = getConfig();
      if (!cfg.enabled) return res.status(503).json({ error: 'disabled' });

      const selected = findAccountByPath(requestPath(req), cfg);
      if (!selected) return res.status(404).json({ error: 'unknown webhook path' });
      if (!selected.channelSecret) return res.status(503).json({ error: 'missing channelSecret' });

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      const signature = req.headers['x-line-signature'];
      if (!verifyLineSignature(rawBody, signature, selected.channelSecret)) {
        return res.status(401).json({ error: 'invalid signature' });
      }

      const payload = safeJsonParse(rawBody);
      if (!payload || !Array.isArray(payload.events)) {
        return res.status(400).json({ error: 'invalid LINE webhook body' });
      }

      for (const event of payload.events) {
        if (eventDedupeStore.seen(selected.id, event.webhookEventId)) continue;
        const text = eventText(event);
        if (!text) continue;

        const type = lineSourceType(event.source);
        const targetId = lineTargetId(event.source);
        if (!targetId) continue;

        const access = decideAccess({
          config: cfg,
          accountId: selected.id,
          event,
          text
        });
        if (access.notification) {
          sendToC4('line', access.notification.endpoint, access.notification.content);
        }
        if (!access.allowed) {
          logger.debug?.(`[line] dropped ${type} event: ${access.reason}`);
          continue;
        }

        const replyKey = replyTokenStore.create({
          accountId: selected.id,
          targetId,
          replyToken: event.replyToken,
          ttlMs: cfg.replyTokenTtlMs
        });
        const endpoint = buildEndpoint(targetId, {
          type,
          accountId: selected.id,
          userId: event.source?.userId,
          replyKey
        });
        const content = formatMessage(type, event.source?.userId || 'unknown', text, { groupName: targetId });
        sendToC4('line', endpoint, content);
      }

      res.json({ ok: true });
    });
  }
}

export function createApp(deps = {}) {
  const app = express();
  registerRoutes(app, deps);
  return app;
}
