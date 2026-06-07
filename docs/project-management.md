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
