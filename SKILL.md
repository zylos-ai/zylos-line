---
name: line
version: 0.1.0
description: >-
  LINE Messaging API communication channel for Zylos. Receives signed LINE
  webhook events, routes inbound messages through C4, sends replies and pushes
  through LINE, handles LINE media, and provides local access-control admin
  commands.
type: communication

lifecycle:
  npm: true
  service:
    type: pm2
    name: zylos-line
    entry: src/index.js
  data_dir: ~/zylos/components/line
  hooks:
    configure: hooks/configure.js
    post-install: hooks/post-install.js
    pre-upgrade: hooks/pre-upgrade.js
    post-upgrade: hooks/post-upgrade.js
  preserve:
    - config.json
    - dm-pairing.json
    - .internal-token
    - media/
    - logs/

http_routes:
  - path: /line/webhook
    target: http://localhost:3984
    type: reverse_proxy

upgrade:
  repo: zylos-ai/zylos-line
  branch: main

config:
  required:
    - name: LINE_CHANNEL_ACCESS_TOKEN
      description: LINE Messaging API channel access token
      sensitive: true
    - name: LINE_CHANNEL_SECRET
      description: LINE Messaging API channel secret
      sensitive: true

bin:
  zylos-line-send: scripts/send.js
  zylos-line-admin: scripts/admin.js

dependencies:
  - comm-bridge
---

# LINE

LINE Messaging API channel component for Zylos.

## Configuration

Runtime config is stored at `~/zylos/components/line/config.json`.
Installation creates this file with safe defaults and `0600` permissions.

Required LINE credentials:

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`

The default webhook path is `/line/webhook`. Edit `config.json` if you need a
different path or multiple LINE accounts, then restart `zylos-line`.

## Sending

```bash
zylos-line-send 'Uxxxxxxxx|type:dm|account:default' 'hello'
echo '[MEDIA:image] https://example.com/photo.png' | zylos-line-send 'Uxxxxxxxx|type:dm|account:default'
```

## Session Groups (multi-session Core)

With a zylos-core that supports multi-session, each inbound message carries a
session group, so every LINE conversation gets its own conversation thread.
Replies still go through the same `reply via` path; the endpoint format and
`zylos-line-send` are unchanged.

| Conversation | Endpoint | Session group | Example |
|---|---|---|---|
| 1:1 chat | `<userId>\|type:dm\|account:<id>\|...` | `dm-<account>:<userId>` | `dm-default:Uxxxxxxxx` |
| Group | `<groupId>\|type:group\|account:<id>\|...` | `group-<account>:<groupId>` | `group-default:Cxxxxxxxx` |
| Multi-person chat | `<roomId>\|type:room\|account:<id>\|...` | `room-<account>:<roomId>` | `room-default:Rxxxxxxxx` |
| Pairing request notice | `admin\|type:dm-pairing\|...` | overall group (`line`) | |

Core adds the `line:` namespace (e.g. `line:dm-default:Uxxxxxxxx`).

- These rules are fixed. Group names are Core's memory keys, so changing them
  would need a migration together with Core.
- One group per LINE account and conversation: the same person chatting with
  two accounts gets two groups. Account ids must match
  `[A-Za-z0-9][A-Za-z0-9_-]*` to be mapped.
- Ids are never truncated or hashed; an endpoint that cannot be mapped (or a
  name over 95 characters) is not sent to Core, and the user is asked to try
  again later. It never falls back to the overall group. `user:` and
  `replyKey:` never affect the group.
- The group is derived and passed only if the installed Core lists
  `--session-group` in `c4-receive-options.json` (re-read on every message).
  Older Cores receive exactly the same arguments as before.
- If Core rejects a message, Core's text goes only to the log. The user gets a
  "try again later" notice when Core stored nothing, a "may not have reached
  me" notice when the outcome is unknown, and nothing when Core already stored
  it. The notice uses the event's reply token, then push. c4-receive runs
  without a timeout and is retried (once, after 2s) only when the process could
  not be started.

```bash
node ~/zylos/.claude/skills/line/scripts/session-group.js "<endpoint>"
# prints e.g. dm-default:Uxxxxxxxx (without "line:"); empty output = overall group
```

## Admin

```bash
zylos-line-admin status
zylos-line-admin owner bind Uxxxxxxxx "Owner Name" --force
zylos-line-admin group add Cxxxxxxxx --allow-all
```

See `README.md` for full setup, send, media, and access-control details.
