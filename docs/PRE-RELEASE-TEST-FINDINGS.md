# zylos-line — Pre-Release Live Walkthrough Findings

**Date:** 2026-06-22
**Context:** Interactive, two-way functionality walkthrough on a live LINE Official
Account (`@642zpbiu`, Channel ID `2010471017`) before re-tagging v0.1.0. Driven
empirically — real messages sent from the LINE app, verified end-to-end through
the webhook → C4 → agent path.

This is a living document; it tracks what was empirically verified and the
findings/fixes that came out of it. Severity legend: **BLOCKER** (must fix before
release) · **MINOR** · **UX** · **SCOPE** (intentional MVP gap, decide) ·
**COSMETIC**.

---

## Test Results

### Inbound (user → agent)

| # | Type | Result | Notes |
|---|------|--------|-------|
| 1 | Text | ✅ Pass | Received verbatim; also exercised the reply-token path. |
| 2 | Image | ✅ Pass | After F1 fix. 1280×1280 JPEG downloaded + viewable. |
| 3 | Video | ✅ Pass | After F1 fix. 15s H.264/AAC mp4; frames extractable for analysis. |
| 4 | Voice / audio | ✅ Pass | After F1 fix. Downloaded + Whisper-transcribed. See F2 (`.bin` ext) + F9 (no auto-ASR). |
| 5 | File / document | ✅ Pass | After F1 fix. <10MB PDF downloaded fine. (First attempt was >10MB → hit size cap, see F3.) |
| 6 | Sticker | ❌ Dropped | Intentional — not handled (see F4). |
| 7 | Location | ❌ Dropped | Intentional — not handled (see F5). |

### Outbound (agent → user)

| Type | Result | Notes |
|------|--------|-------|
| Text | ✅ Pass | Confirmed via replies (reply-token + push fallback). |
| Image | ✅ Pass | `[MEDIA:image] <https-url>` — rendered inline. |
| Video | ✅ Pass | `[MEDIA:video] <url> <preview>` — rendered with thumbnail + play. |
| Audio | ✅ Pass | `[MEDIA:audio] <url> <durationMs>` — rendered + playable. |

### Delivery mechanics

| Mechanism | Result |
|-----------|--------|
| Reply via reply-token | ✅ Pass |
| Push (proactive / post-token) | ✅ Pass (all outbound media + long msg sent via push) |
| Long-message splitting | ✅ Pass (5988-char msg → 2 bubbles, no content loss) |

---

## Findings

### F1 — Inbound media fetched from the wrong host → all media silently dropped
- **Severity:** BLOCKER
- **Status:** ✅ Fixed (committed pending)
- **Root cause:** `src/lib/media.js` `downloadLineMessageContent()` built the
  content URL from `LINE_API_BASE` (`https://api.line.me`). LINE serves binary
  message content from a **separate host**, `https://api-data.line.me`. The
  `api.line.me` host returns **HTTP 404** for `/v2/bot/message/{id}/content`, the
  download threw, and the route handler caught it and `continue`d — so **every**
  inbound image/video/audio/file was silently dropped. Text was unaffected (it
  never calls the content API), which masked the bug during the initial live-fire.
- **Fix:** Added `LINE_API_DATA_BASE = 'https://api-data.line.me'` in
  `src/lib/line-api.js`; `media.js` now uses it for the content endpoint. Updated
  `test/media.test.js` (its assertion had encoded the buggy URL). 83/83 tests pass.
- **Verified:** Image/video/voice all downloaded successfully post-fix.

### F2 — Voice/audio saved with `.bin` extension
- **Severity:** MINOR
- **Status:** Open
- **Root cause:** LINE returns voice content with content-type `audio/x-m4a`,
  which is not in the `extensionFor()` map (`media.js` has `audio/mp4`,
  `audio/aac`, `audio/mpeg` only) → falls back to `.bin`. File bytes are correct
  (valid M4A), only the extension is wrong.
- **Fix:** Add `audio/x-m4a` → `.m4a` (and consider `audio/m4a`, `audio/x-aac`)
  to the extension map.

### F3 — Oversized / failed media is silently dropped (no sender feedback)
- **Severity:** UX
- **Status:** Open
- **Root cause:** When a download exceeds `mediaMaxMb` (default 10) or otherwise
  fails, the route handler logs a warning and `continue`s — the sender gets no
  indication their file was rejected. Observed live with a >10MB PDF.
- **Fix:** On size-exceed / download failure, send the user a notice (e.g.
  "⚠️ couldn't receive that file — it exceeds the NN MB limit").
- **Decision needed:** keep the 10MB cap or raise it (LINE allows larger content;
  ~20MB suggested). The size guard itself is correct and should stay.

### F4 — Inbound stickers dropped
- **Severity:** SCOPE
- **Status:** Open (decide)
- **Detail:** `eventPlaceholder()` returns `''` for `sticker` messages → dropped.
  Stickers are heavily used on LINE.
- **Option:** forward as a placeholder (e.g. `<sticker>` or map to the sticker's
  keyword/emoji from `event.message.keywords`).

### F5 — Inbound location dropped
- **Severity:** SCOPE
- **Status:** Open (decide)
- **Detail:** `location` messages dropped. Could forward as text
  (title / address / lat,long).

### F6 — Lifecycle events not surfaced
- **Severity:** SCOPE
- **Status:** Open (decide)
- **Detail:** `follow`/`unfollow`, `join`/`leave`, `memberJoined`/`memberLeft`
  are not handled → e.g. no auto-greeting when a user adds the OA, no awareness
  when added to / removed from a group.

### F7 — Group/room name unresolved
- **Severity:** COSMETIC
- **Status:** Open
- **Detail:** Group/room messages are tagged with the raw `groupId`/`roomId`
  instead of a human name (no group-summary API lookup).

### F8 — Owner display name stored as raw userId
- **Severity:** COSMETIC
- **Status:** Open
- **Detail:** On owner auto-bind, `name` is set to the userId (no profile API
  lookup). Observed during live-fire.

### F9 — Voice not auto-transcribed at the comm layer (parity)
- **Severity:** SCOPE / parity
- **Status:** Open (decide)
- **Detail:** LINE forwards voice as a raw audio file (`<media:audio>`). Some
  other Zylos channels ASR at the comm layer and hand the agent
  `[Voice] <transcribed text>`. The agent can transcribe on-demand (Whisper), but
  this is a behavioral inconsistency to consciously accept or close.

---

## Release Gate

**Approved pre-release fix batch (Felix, 2026-06-22): F1–F5.** All small,
additive, test-covered. Ship together, then re-review → re-tag v0.1.0.

- **F1** media-host — ✅ implemented + tested
- **F2** audio extension map (`audio/x-m4a`/`audio/m4a`/`audio/x-aac` → `.m4a`/`.aac`) — ✅ implemented + tested
- **F3** failed/oversized media → descriptive placeholder (no silent drop); default cap raised 10→20MB — ✅ implemented + tested
- **F4** inbound stickers (keywords→text) — ✅ implemented + tested
- **F5** inbound location (title/address/coords→text) — ✅ implemented + tested
- **Tests:** 93/93 pass (was 83; +4 for F2–F5, +3 for the access-control deny/leak paths surfaced by the cross-review).
- Because F1 changes shipped code, head moves off the last-reviewed commit →
  **production-readiness re-review with Local required before re-tagging** (Felix, 2026-06-22).

**Deferred to v0.1.1 (track, not blocking):**

- **F6** lifecycle events (follow/unfollow, join/leave) — incl. auto-greeting on follow
- **F7** group/room name resolution
- **F8** owner display-name resolution
- **F9** voice auto-transcription parity
