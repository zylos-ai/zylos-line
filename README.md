# zylos-line

LINE Messaging API channel component for Zylos.

## Features

- Multi-account LINE webhook support with deterministic webhook path selection.
- LINE `X-Line-Signature` verification over raw request body bytes before JSON
  parsing.
- Signed POST webhook verification path, including `events: []`.
- `webhookEventId` TTL dedupe.
- Server-side reply-token handle storage; C4 endpoints carry only
  `replyKey:<nonce>`, never raw LINE reply tokens.
- Outbound text send path with reply-token consumption, reply API for the first
  timely batch of up to five message objects, and push fallback for overflow,
  expired handles, and proactive sends.
- DM, group, and room access gates with owner auto-bind, owner bypass,
  allowlists, pairing, and disabled modes.
- Local admin CLI for owner, policy, allowlist, group/room, and DM pairing
  operations.
- Inbound LINE image, video, audio, and file downloads from the fixed LINE
  content API after strict message-id validation and size checks.
- Outbound `[MEDIA:image]`, `[MEDIA:video]`, and `[MEDIA:audio]` markers with
  shared public-URL preflight before LINE media message construction.
- Packaging allowlist for runtime files only.

## Secure Defaults

Default config is intentionally conservative:

| Key | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | Service accepts signed webhook requests when credentials are configured. |
| `port` | `3984` | Runtime binds to `127.0.0.1`; expose it through the Zylos HTTP/proxy layer. |
| `webhookPath` | `/line/webhook` | LINE uses signed POST, not GET verification. |
| `dmPolicy` | `owner` | Only the bound owner can DM by default. |
| `dmAllowFrom` | `[]` | Used by `allowlist` and approved pairing flows. |
| `groupPolicy` | `allowlist` | Groups/rooms must be configured by default. |
| `groups` | `{}` | Configured group/room `allowFrom: []` means allow all senders in that conversation. |
| `mediaMaxMb` | `20` | Applies to inbound LINE media and outbound media URL preflight. Media exceeding this is not dropped silently — the agent receives a descriptive placeholder. |
| `requestMaxBytes` | `1mb` | Express raw-body limit for LINE webhooks. |
| `replyTokenTtlMs` | `60000` | Local reply-token handle lifetime. |
| `webhookDedupTtlMs` | `86400000` | `webhookEventId` dedupe lifetime. |

Signature verification is always required for webhook POSTs. Do not log raw
webhook bodies or disable signature checks for troubleshooting.

## Configuration

Runtime config lives at:

```text
~/zylos/components/line/config.json
```

Secret fields may be supplied directly by the installer, through secret files,
or through environment variables:

```json
{
  "channelAccessToken": "YOUR_CHANNEL_ACCESS_TOKEN",
  "channelSecret": "YOUR_CHANNEL_SECRET",
  "webhookPath": "/line/webhook",
  "dmPolicy": "owner",
  "groupPolicy": "allowlist",
  "mediaMaxMb": 20,
  "requestMaxBytes": "1mb"
}
```

For multiple LINE accounts, configure unique webhook paths:

```json
{
  "accounts": {
    "support": {
      "channelAccessToken": "YOUR_SUPPORT_CHANNEL_ACCESS_TOKEN",
      "channelSecret": "YOUR_SUPPORT_CHANNEL_SECRET",
      "webhookPath": "/line/webhook/support"
    }
  }
}
```

`config.json` is written with `0o600` permissions. `logs/` and `media/` are
created under `~/zylos/components/line/` by install, upgrade, and service
startup.

## Webhook Setup

Point each LINE Messaging API channel webhook URL at the HTTPS route that maps
to the configured local webhook path. The component itself listens on
`127.0.0.1`; the Zylos HTTP/proxy layer should provide the public HTTPS route.

Use LINE's signed POST verification flow. A signed body with `events: []` is
accepted as verification. GET requests to the webhook path are health-only and
are not LINE verification.

## Send CLI

Package bins are namespaced to avoid global command collisions:

```bash
zylos-line-send 'Uxxxxxxxx|type:dm|account:default|replyKey:REPLY_KEY' 'hello'
echo 'hello' | zylos-line-send 'Uxxxxxxxx|type:dm|account:default'
echo '[MEDIA:image] https://example.com/photo.png' | zylos-line-send 'Uxxxxxxxx|type:dm|account:default'
```

Direct script invocation also works:

```bash
node scripts/send.js 'Uxxxxxxxx|type:dm|account:default' 'hello'
```

Outbound media markers:

```text
[MEDIA:image] https://example.com/photo.png
[MEDIA:video] https://example.com/video.mp4 https://example.com/preview.jpg
[MEDIA:audio] https://example.com/audio.m4a 12000
```

Outbound media URLs must be HTTPS, must not contain credentials, must pass
public-address SSRF checks on every redirect hop, and must provide content type
and content length headers within `mediaMaxMb`.

## Admin CLI

The admin CLI is local-only; it is not exposed by any HTTP route.

```bash
zylos-line-admin status
zylos-line-admin owner bind Uxxxxxxxx "Owner Name" --force
zylos-line-admin policy dm owner
zylos-line-admin policy group allowlist
zylos-line-admin dm-allow add Uxxxxxxxx
zylos-line-admin dm-allow remove Uxxxxxxxx --confirm-empty
zylos-line-admin group add Cxxxxxxxx Uxxxxxxxx
zylos-line-admin group add Rxxxxxxxx --allow-all
zylos-line-admin group remove-user Cxxxxxxxx Uxxxxxxxx --confirm-empty
zylos-line-admin pairing list
zylos-line-admin pairing approve Uxxxxxxxx
zylos-line-admin pairing deny Uxxxxxxxx
```

Direct script invocation also works:

```bash
node scripts/admin.js status
```

Removing the last entry from `dmAllowFrom` or a group/room `allowFrom` requires
`--confirm-empty`. This avoids accidentally converting a restricted list into
an empty allow-all list for a configured group/room.

Adding a user to a group/room that is currently configured with `--allow-all`
changes that conversation from allow-all to restricted-to-listed-users.
`pairing deny` only denies a pending pairing request; it does not revoke an
already-approved user. Use `dm-allow remove` for revocation.

`status` output is redacted: it reports booleans and metadata, not channel
tokens or secrets.

## Package Contents

The npm package uses an explicit `files` allowlist. Runtime package contents are:

- `README.md`, `DESIGN.md`, `CHANGELOG.md`, `LICENSE`, `SKILL.md`
- `ecosystem.config.cjs`
- `hooks/`
- `scripts/`
- `src/`

Tests, local media, logs, temporary files, and runtime config are not packaged.

## Development

```bash
npm install
npm test
npm run check
npm audit --omit=dev
npm pack --dry-run --json
```

## Troubleshooting

- `401 invalid signature`: verify the LINE channel secret and make sure the
  proxy forwards the exact raw request body to the service.
- `503 disabled`: set `enabled: true` in config and restart the service.
- No DM delivery under default config: bind or approve the user, or explicitly
  change `dmPolicy`.
- Group/room messages denied by default: add the `Cxxxxxxxx` group or
  `Rxxxxxxxx` room with `zylos-line-admin group add`.
- Media send rejected: verify the URL is HTTPS, public, has no credentials,
  returns a supported content type, and includes a valid `Content-Length` within
  `mediaMaxMb`.

Never paste real access tokens, channel secrets, private user IDs, or raw
webhook bodies into shared logs or issue reports.
