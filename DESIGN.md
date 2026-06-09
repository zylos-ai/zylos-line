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

The early slices intentionally exclude media, rich message helpers, access
control, config hot reload, and LINE profile/group-name resolution. Account
changes require a service restart in this slice. Profile and group display names
currently use raw LINE IDs in C4 envelopes.
