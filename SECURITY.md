# Security Policy

## Supported Versions

SwipeShortlist is in early development. Security fixes should target the current `main` branch unless a release branch is explicitly created.

## Reporting A Vulnerability

Do not open a public issue for vulnerabilities that expose secrets, private links, databases, deployment paths, or server access.

Report privately to the repository owner on GitHub with:

- affected commit or branch
- steps to reproduce
- expected impact
- any logs or screenshots that do not expose secrets

## Deployment Expectations

- Bind the app to `127.0.0.1`.
- Use Tailscale SSH, SSH tunnels, Caddy, or Cloudflare Tunnel for access.
- Keep `SWIPE_DB_PATH`, env files, and SQLite data outside the repo.
- Do not expose `/srv/codex/apps`, `/etc/codex/env.d`, or repository internals through a public web root.
