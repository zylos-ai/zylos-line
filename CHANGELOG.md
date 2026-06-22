# Changelog

## 0.1.0 - Unreleased

### Added

- Initial LINE Messaging API component for Zylos.
- Signed webhook handling with LINE `X-Line-Signature` verification over the
  raw request body.
- Multi-account webhook routing with unique webhook paths.
- Webhook event dedupe using `webhookEventId`.
- Reply-token handle storage so C4 endpoints carry opaque `replyKey` values,
  not raw LINE reply tokens.
- Outbound text sending with reply-token consumption, LINE reply API use for
  timely batches, push fallback, and deterministic push retry keys.
- DM, group, and room access controls with owner auto-bind, owner bypass,
  allowlists, pairing flow, disabled modes, and local admin commands.
- Inbound LINE image, video, audio, and file downloads through LINE's content
  API with message-id validation and size checks.
- Outbound `[MEDIA:image]`, `[MEDIA:video]`, and `[MEDIA:audio]` markers with
  HTTPS public-URL validation, redirect checks, content type checks, and size
  limits before LINE message construction.
- Lifecycle hooks for install, configure, pre-upgrade, and post-upgrade.
- Namespaced CLI bins: `zylos-line-send` and `zylos-line-admin`.
- Declarative `SKILL.md` metadata for `zylos add` installation.
- Release documentation covering secure defaults, webhook setup, send/admin
  usage, media markers, package contents, and troubleshooting.

### Security

- Webhook signatures are required before JSON parsing.
- Secret files are read only from regular files; symlinks are ignored.
- Runtime config is written with `0600` permissions.
- The service binds to `127.0.0.1` by default.
- Outbound media URL preflight rejects credentials, unsafe address ranges,
  unsafe redirects, encoded private IPv4 forms, and mismatched connected peers.
- Admin status output redacts channel tokens and secrets.
- Reply-token storage is concurrency-safe across the webhook service and
  `zylos-line-send` processes: the read-modify-write transaction is guarded by a
  cross-process file lock with stale-lock recovery, and atomic writes use
  per-writer temp files to avoid concurrent clobbering.

### Fixed

- Inbound media (image/video/audio/file) was silently dropped: content was
  fetched from `api.line.me`, but LINE serves binary message content from
  `api-data.line.me` (the former 404s). All media downloads now use the correct
  content host. *(Found via live walkthrough; would have shipped broken.)*
- Voice/audio content typed `audio/x-m4a` (and `audio/m4a`, `audio/x-aac`) now
  map to correct extensions instead of falling back to `.bin`.
- Media that exceeds the size cap or otherwise fails to download is no longer
  silently dropped — the agent receives a descriptive placeholder
  (e.g. `[file too large (over the 20 MB limit)]`) so it can tell the user.

### Added (post-walkthrough)

- Inbound **stickers** are forwarded as `[Sticker: <keywords>]` (from the LINE
  sticker keywords; falls back to package/sticker IDs). No content download.
- Inbound **location** messages are forwarded as
  `[Location: <title> — <address> (<lat>, <lon>)]`.

### Changed

- Default `mediaMaxMb` raised from 10 to 20.

### Known Follow-Ups

- Richer message helper builders beyond current text and media markers.
- Config hot reload; account and config changes require a restart.
- LINE profile and group display-name resolution; C4 envelopes currently use
  raw LINE IDs.
- Lifecycle/event surfacing (follow/unfollow, join/leave) and a follow
  auto-greeting (tracked for v0.1.1).
