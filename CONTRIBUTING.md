# Contributing

Thanks for helping improve SwipeShortlist.

## Workflow

1. Fork or branch from `main`.
2. Keep changes focused on one user-visible or operational outcome.
3. Run the local checks before opening a pull request:

```bash
npm test
npm start
npm run smoke
npm run sync:status
```

4. Open a pull request against `main`.
5. Keep the PR updated until CI is green.

Direct pushes to `main` should be avoided. Use pull requests for code, docs, deployment scripts, and repo-governance changes.

## Product Rules

- Preserve the core flow: paste links, share one private voting link, vote No/Hold/Yes, send one winner.
- Do not add dashboards, chat, accounts, planning boards, or analytics unless there is a specific accepted product decision.
- Do not claim verified price, availability, or expiry unless the backend enforces it.

## Deployment Rules

- Keep production origins bound to `127.0.0.1`.
- Store SQLite data outside the repository.
- Do not commit databases, env files, credentials, logs, or local browser artifacts.
- Include local smoke-test evidence and VPS health evidence when changing deployment behavior.
