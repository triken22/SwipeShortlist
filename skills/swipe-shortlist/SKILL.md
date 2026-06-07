---
name: swipe-shortlist
description: Use when changing SwipeShortlist product behavior, UI fidelity, persistence, smoke tests, or VPS deployment.
---

# SwipeShortlist Skill

## First Read

1. `AGENTS.md`
2. `memory/PROJECT_MEMORY.md`
3. `docs/source-of-truth.md`

## Product Rules

- Preserve the one-job flow: create link, vote cards, send winner.
- Do not turn the app into project management, trip planning, or a dashboard.
- Keep every extra feature accountable to reducing group-decision pain.

## Implementation Rules

- Use the existing static frontend and Node server unless a concrete blocker requires a stack change.
- Keep production data external to the repo.
- Keep visible UI copy short and specific.
- Add tests for changed ranking, persistence, or API behavior.

## Verification

Run:

```bash
npm test
npm start
npm run smoke
```

Then inspect desktop and mobile browser screenshots against the three reference images.
