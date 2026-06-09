# zylos-line

LINE Messaging API channel component for Zylos.

Current slice: C5 access control and pairing.

Implemented:
- Component scaffold, PM2 config, install/configure hooks, and 0o600 config writes.
- Multi-account config shape with deterministic webhook path selection.
- LINE `X-Line-Signature` verification over raw request body bytes before JSON parsing.
- Signed POST webhook verification path, including `events: []`.
- `webhookEventId` TTL dedupe.
- Server-side reply-token handle storage with C4 endpoints carrying only `replyKey:<nonce>`.
- Outbound text send path with reply-token consumption, reply API for the first
  timely batch of up to five message objects, and push fallback for overflow,
  expired handles, and proactive sends.
- Access gates for DMs, groups, and rooms with first-DM owner auto-bind,
  owner bypass, `dmPolicy` (`open`, `allowlist`, `owner`, `pairing`,
  `disabled`), default group allowlist, configured group/room `allowFrom`, and
  a fail-closed DM pairing queue.

Not yet implemented:
- Media and rich LINE message types.
- Admin CLI approval commands and full docs.
- Config hot reload; account changes require service restart in this slice.
- LINE profile and group-name resolution; C2 envelopes use raw LINE IDs.

## Development

```bash
npm install
npm test
npm run check
```

## Send Script

```bash
node scripts/send.js 'U123|type:dm|account:default|replyKey:abc123' 'hello'
echo 'hello' | node scripts/send.js 'U123|type:dm|account:default'
```
