# SwipeShortlist

[![CI](https://github.com/triken22/SwipeShortlist/actions/workflows/ci.yml/badge.svg)](https://github.com/triken22/SwipeShortlist/actions/workflows/ci.yml)

SwipeShortlist turns messy group-chat links into one private voting flow and one final pick. It is intentionally simple: paste real links, share the private link, vote through cards with No/Hold/Yes, then send the winner. Empty shortlists are rejected; the app does not seed example cards.

## Project Status

SwipeShortlist is an early open-source app intended for private, self-hosted deployment. The current production shape is a dependency-light Node app with SQLite persistence, designed to run behind a loopback-only origin on a VPS.

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
npm run sync:status
```

## VPS Shape

The intended private deployment is:

- repo: `/srv/codex/repos/swipe-shortlist`
- active release: `/srv/codex/repos/swipe-shortlist/current`
- releases: `/srv/codex/repos/swipe-shortlist/releases/<sha>`
- data: `/srv/codex/apps/swipe-shortlist/data`
- backups: `/srv/codex/apps/swipe-shortlist/backups`
- env: `/etc/codex/env.d/swipe-shortlist.env`
- service: `swipe-shortlist.service`
- origin: `127.0.0.1:8092`

Keep the origin loopback-only. Use a Tailscale SSH tunnel or an approved Caddy/Cloudflare Tunnel route for access.

For temporary public internet access without opening the app port, deploy with:

```bash
ENABLE_PUBLIC_TUNNEL=1 ./ops/deploy-vps.sh
```

This installs `swipe-shortlist-tunnel.service`, a Cloudflare quick tunnel that proxies to `127.0.0.1:8092`. The quick-tunnel URL is written on the VPS to `/srv/codex/apps/swipe-shortlist/public-url.txt`. For production, replace this with a named Cloudflare Tunnel or a dedicated Caddy hostname because quick-tunnel URLs can change after service restarts.

GitHub Actions deployment is defined in `.github/workflows/deploy-vps.yml`. Configure the `production-vps` environment plus the secrets and variables listed in `docs/project-management.md`, then run the workflow manually or set `AUTO_DEPLOY_VPS=true` to deploy from `main`.

## Project Management

- `main` is the stable branch.
- Work should happen on feature branches and be merged by pull request.
- CI must pass before a pull request is merged.
- Codex PR review is available through hosted Codex review or the in-repo `codex-review` workflow once `OPENAI_API_KEY` is configured.
- Deployment changes should include local smoke-test evidence and VPS health evidence.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [docs/agent-orchestration.md](docs/agent-orchestration.md).
