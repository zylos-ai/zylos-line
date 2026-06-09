# zylos-line

LINE Messaging API channel component for Zylos.

Current slice: C6 admin CLI.

Implemented:
- Component scaffold, PM2 config, install/configure/upgrade hooks, runtime
  directory creation, and 0o600 config writes.
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
- Local admin CLI for owner, policy, allowlist, group/room, and DM pairing
  operations with strict LINE ID validation, redacted status output, and
  explicit confirmation before a removal empties an allowlist.
- Inbound LINE image, video, audio, and file messages are downloaded from the
  fixed LINE content API after strict message-id validation and size checks, then
  forwarded to C4 with a local file path.
- Outbound `[MEDIA:image]`, `[MEDIA:video]`, and `[MEDIA:audio]` markers with
  shared public-URL preflight before creating LINE media message objects.
- Outbound media URL preflight enforces HTTPS-only, no credentials, public IP
  ranges only, redirect revalidation, content type and size caps, DNS-result
  pinning for the connection, and actual connected-peer validation.

Not yet implemented:
- Rich LINE message types beyond basic media markers.
- Admin CLI approval commands and full docs.
- Config hot reload; account changes require service restart in this slice.
- LINE profile and group-name resolution; C2 envelopes use raw LINE IDs.

## Development

```bash
npm install
npm test
npm run check
```

## Runtime Data

Lifecycle hooks create and preserve runtime state under
`~/zylos/components/line/`:

- `config.json` stores normalized component config and is written with `0o600`
  permissions.
- `logs/` is used by PM2 log paths.
- `media/` stores inbound LINE media fetched from the fixed LINE content API.

Default config is intentionally conservative: DMs are owner-only, groups are
allowlist-only, media is capped by `mediaMaxMb`, and webhook request bodies are
capped by `requestMaxBytes`.

## Send Script

```bash
node scripts/send.js 'U123|type:dm|account:default|replyKey:abc123' 'hello'
echo 'hello' | node scripts/send.js 'U123|type:dm|account:default'
echo '[MEDIA:image] https://example.com/photo.png' | node scripts/send.js 'U123|type:dm|account:default'
```

## Admin CLI

The admin CLI is local-only; it is not exposed by the HTTP service.

```bash
node scripts/admin.js status
node scripts/admin.js owner bind U123 "Owner Name" --force
node scripts/admin.js policy dm owner
node scripts/admin.js policy group allowlist
node scripts/admin.js dm-allow add U123
node scripts/admin.js dm-allow remove U123 --confirm-empty
node scripts/admin.js group add C123 U123
node scripts/admin.js group add R123 --allow-all
node scripts/admin.js group remove-user C123 U123 --confirm-empty
node scripts/admin.js pairing list
node scripts/admin.js pairing approve U123
node scripts/admin.js pairing deny U123
```

Removing the last entry from `dmAllowFrom` or a group/room `allowFrom` requires
`--confirm-empty` because an empty configured group/room `allowFrom` means
allow-all for that conversation.

Adding a user to a group/room that is currently configured with `--allow-all`
changes that conversation from allow-all to restricted-to-listed-users.
`pairing deny` only denies a pending pairing request; it does not revoke an
already-approved user. Use `dm-allow remove` for revocation.
