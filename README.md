# zylos-line

LINE Messaging API channel component for Zylos.

Current slice: C1/C2 scaffold and signed webhook receiver.

Implemented:
- Component scaffold, PM2 config, install/configure hooks, and 0o600 config writes.
- Multi-account config shape with deterministic webhook path selection.
- LINE `X-Line-Signature` verification over raw request body bytes before JSON parsing.
- Signed POST webhook verification path, including `events: []`.
- `webhookEventId` TTL dedupe.
- Server-side reply-token handle storage with C4 endpoints carrying only `replyKey:<nonce>`.

Not yet implemented:
- Outbound reply/push send path.
- Access control and pairing.
- Media and rich LINE message types.
- Admin CLI and full docs.
- Config hot reload; account changes require service restart in this slice.
- LINE profile and group-name resolution; C2 envelopes use raw LINE IDs.

## Development

```bash
npm install
npm test
npm run check
```
