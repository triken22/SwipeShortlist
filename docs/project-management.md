# Project Management

SwipeShortlist should be managed as a pull-request-first open-source project.

## Branches

- `main`: stable, deployable branch.
- `feature/*`: implementation branches.
- `fix/*`: bug-fix branches.
- `docs/*`: documentation and project-management updates.

## Pull Requests

Every material change should use a pull request. A clean PR includes:

- clear summary
- test/smoke evidence
- screenshots for UI changes
- deployment evidence for VPS changes
- linked issue when relevant

Codex review is supported in two ways:

- Hosted Codex review: enable Codex code review for the repository, then use automatic reviews or comment `@codex review`.
- In-repo workflow: `.github/workflows/codex-review.yml` runs `openai/codex-action@v1` on same-repository pull requests when `OPENAI_API_KEY` is configured.

The workflow is advisory at first. Keep CI as the merge-blocking signal until the Codex review quality is proven on this codebase.

## Sync Discipline

Use this command before and after meaningful work:

```bash
npm run sync:status
```

It fetches remotes, shows branch tracking, and reports whether the working tree is clean.

## Release Discipline

When the app moves beyond prototype status:

1. Tag releases from `main`.
2. Add release notes from `CHANGELOG.md`.
3. Deploy from the release tag or a known commit SHA.
4. Record VPS health evidence after deployment.

## GitHub Automation

Required checks:

- `test`: Node test suite plus local smoke test.
- `analyze`: CodeQL JavaScript/TypeScript scan. Keep this visible even if it is not initially branch-protection required.

Dependabot runs weekly for npm and GitHub Actions. The auto-merge workflow only enables auto-merge for GitHub Actions updates and npm patch/minor updates; npm major updates stay manual.

Recommended repository settings:

- Main branch protected.
- Require branch to be up to date before merge.
- Require status check `test`.
- Require conversation resolution.
- Require linear history.
- Require one review and CODEOWNERS review, with admin enforcement left off while this is a single-owner project.
- Use squash merge, delete head branches after merge, and keep auto-merge enabled for Dependabot.

## Production Deployment

Use `.github/workflows/deploy-vps.yml` for production deploys once GitHub secrets and variables are configured.

Environment: `production-vps`

Secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_SSH_KNOWN_HOSTS`

Variables:

- `VPS_HOST=100.88.9.93`
- `VPS_USER=root`
- `TS_TAGS=tag:ci`
- `AUTO_DEPLOY_VPS=false` unless automatic deploys from `main` are intentionally enabled
- `ENABLE_PUBLIC_TUNNEL=0` for normal production deploys

The workflow verifies tests and local smoke before deployment, joins Tailscale, SSHes to the VPS, runs `ops/deploy-vps.sh`, and checks:

- `swipe-shortlist.service` is active
- `/health` responds on `127.0.0.1:8092`
- the listener is loopback-only
- `/srv/codex/apps/swipe-shortlist/data` is writable

The deploy script writes releases to `/srv/codex/repos/swipe-shortlist/releases/<sha>`, switches `/srv/codex/repos/swipe-shortlist/current`, and backs up SQLite before restarting the service.
