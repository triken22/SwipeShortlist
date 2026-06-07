# SwipeShortlist

SwipeShortlist turns messy group-chat links into one private voting flow and one final pick. It is intentionally simple: create a shortlist, share the private link, vote through cards with No/Hold/Yes, then send the winner.

## Run Locally

```bash
npm start
```

The app binds to `127.0.0.1:8092` by default.

Useful environment variables:

```bash
HOST=127.0.0.1
PORT=8092
SWIPE_DATA_DIR=/srv/codex/apps/swipe-shortlist/data
SWIPE_DB_PATH=/srv/codex/apps/swipe-shortlist/data/swipe-shortlist.sqlite
```

## Checks

```bash
npm test
npm start
npm run smoke
```

## VPS Shape

The intended private deployment is:

- repo: `/srv/codex/repos/swipe-shortlist`
- data: `/srv/codex/apps/swipe-shortlist/data`
- env: `/etc/codex/env.d/swipe-shortlist.env`
- service: `swipe-shortlist.service`
- origin: `127.0.0.1:8092`

Keep the origin loopback-only. Use a Tailscale SSH tunnel or an approved Caddy/Cloudflare Tunnel route for access.
