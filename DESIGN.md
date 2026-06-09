# zylos-line Design

`zylos-line` follows the webhook-channel shape used by other Zylos channel
components. LINE-specific protocol handling is intentionally isolated:

- `src/lib/signature.js` verifies `X-Line-Signature` with HMAC-SHA256 over the
  raw request body.
- `src/lib/reply-token-store.js` stores single-use LINE reply tokens behind
  short-lived local handles. The store re-reads and rewrites the local state file
  on each create/consume because tokens are created by the service process and
  consumed by C4-spawned send processes. C4 endpoints never include raw reply
  tokens.
- `src/lib/event-dedupe.js` tracks `webhookEventId` values to avoid duplicate C4
  delivery on webhook redelivery. The dedupe store keeps process-local state as
  the primary mutation source because webhook dedupe is service-process local.
- `src/routes.js` selects the LINE account by webhook path before signature
  verification, then parses the JSON body only after HMAC passes.
- `scripts/send.js` parses C4 endpoints, consumes a `replyKey` handle at most
  once, sends the first timely batch of up to five text message objects via the
  reply API, and uses push for overflow, late, or proactive sends. Retry keys are
  attached only to push requests.
- `src/lib/access.js` applies the inbound access gate after signature, dedupe,
  message extraction, and source identification, but before reply-token handle
  creation. The gate order is first-DM owner auto-bind, owner bypass, DM policy,
  then group/room policy. Configured group or room entries with empty
  `allowFrom` arrays allow all senders in that conversation; non-empty arrays
  allow only matching LINE user IDs.
- `src/lib/dm-pairing.js` stores pending DM pairing requests separately from
  config. Pairing mode never auto-approves unpaired users: it queues and
  surfaces the request to C4, drops the original inbound message, and denies on
  pairing-state read or write errors.
- `src/lib/media.js` owns LINE media handling. Inbound media is fetched only by
  a validated LINE message ID through LINE's content API, never by a user
  supplied URL. Outbound media markers are preflighted before they become LINE
  message objects: URLs must be HTTPS, must not include credentials, must not
  resolve to private/loopback/link-local/multicast addresses, redirects are
  revalidated, and content type/size caps are enforced. The outbound guard
  canonicalizes URL hosts before range checks, rejects encoded private IPv4
  forms and IPv4-mapped private IPv6 addresses, resolves DNS once, connects by
  the validated resolved address, and validates the actual connected peer before
  trusting the response. Each redirect hop repeats the full guard.
- `hooks/post-install.js`, `hooks/post-upgrade.js`, and `src/index.js` all call
  the shared runtime directory initializer so `logs/` and `media/` exist before
  PM2 logging or inbound media writes need them. Install preserves existing
  config, while configure rewrites normalized config with `0o600` permissions.
- `package.json` uses an explicit npm `files` allowlist so tests, fixtures, local
  media, logs, and other workspace artifacts are not shipped by accident.

The early slices intentionally exclude rich message helpers, access admin
commands, config hot reload, and LINE profile/group-name resolution. Account
changes require a service restart in this slice. Profile and group display
names currently use raw LINE IDs in C4 envelopes.
