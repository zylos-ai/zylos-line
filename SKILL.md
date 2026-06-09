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

## Admin

```bash
zylos-line-admin status
zylos-line-admin owner bind Uxxxxxxxx "Owner Name" --force
zylos-line-admin group add Cxxxxxxxx --allow-all
```

See `README.md` for full setup, send, media, and access-control details.
