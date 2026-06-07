# Project Memory

## Stable Decision

The project is SwipeShortlist: a private, Tinder-like group decision closer for people drowning in travel, restaurant, apartment, or product links.

## Durable Design Notes

- The app must feel like a painkiller, not a vitamin.
- The interaction model is swipe/tap first: No, Hold, Yes.
- Hide peer votes until the current user has voted.
- Results should close the loop with one winner and at most a small backup affordance.
- No accounts, no app install, no group-chat spam.
- Avoid false certainty: do not claim lowest price or verified availability unless the backend actually checks it.

## Current Implementation Notes

- Backend: dependency-light Node HTTP server.
- Persistence: SQLite via Node's built-in `node:sqlite`, with data stored under `SWIPE_DATA_DIR` or `SWIPE_DB_PATH`.
- Frontend: static HTML/CSS/JS served by the backend.
- Private VPS origin: `127.0.0.1:8092`.

## Agent Operating Model

- Parent Codex is the goal owner and meta-orchestrator.
- RepoPrompt Orchestrator is an execution agent, not the final authority.
- Critic is read-only and should only surface failure modes with evidence.
- Max iterations stay capped at 5 per run.
- Final closure requires parent Codex to verify PR, browser, tests, smoke, and VPS status.

## Deployment Memory

Follow the existing private app pattern:

- `/srv/codex/repos/swipe-shortlist` for source
- `/srv/codex/apps/swipe-shortlist/data` for SQLite data
- `/etc/codex/env.d/swipe-shortlist.env` for service env
- systemd service bound to loopback
- access through SSH tunnel or approved reverse proxy/tunnel
