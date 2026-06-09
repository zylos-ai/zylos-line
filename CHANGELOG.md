# Changelog

## 0.1.0 - 2026-06-09

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

### Known Follow-Ups

- Richer message helper builders beyond current text and media markers.
- Config hot reload; account and config changes require a restart.
- LINE profile and group display-name resolution; C4 envelopes currently use
  raw LINE IDs.
