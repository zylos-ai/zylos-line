# zylos-line Design

`zylos-line` follows the webhook-channel shape used by other Zylos channel
components. LINE-specific protocol handling is intentionally isolated:

- `src/lib/signature.js` verifies `X-Line-Signature` with HMAC-SHA256 over the
  raw request body.
- `src/lib/reply-token-store.js` stores single-use LINE reply tokens behind
  short-lived local handles. C4 endpoints never include raw reply tokens.
- `src/lib/event-dedupe.js` tracks `webhookEventId` values to avoid duplicate C4
  delivery on webhook redelivery.
- `src/routes.js` selects the LINE account by webhook path before signature
  verification, then parses the JSON body only after HMAC passes.

The first slice intentionally excludes outbound send, media, rich message
helpers, and access control. Those land in later slices.
