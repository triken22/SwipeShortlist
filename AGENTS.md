# Agent Instructions

## Product Spine

SwipeShortlist is a decision closer, not a planning dashboard. Preserve the core job:

1. Paste messy links.
2. Send one private voting link.
3. Vote through cards with No/Hold/Yes.
4. Reveal one final pick.

Do not add chat, feeds, Kanban, analytics dashboards, account setup, social profiles, or multi-step configuration unless the user explicitly asks. The product pain is time scarcity and group indecision.

## Source Of Truth

Reference images:

- Create: `/Users/tristankennedy/.codex/generated_images/019ea37b-6df9-7b82-a42c-a07be744155a/ig_007bcecd21ed5379016a25c9ce8ac08198bd7d000eb41ca3ed.png`
- Vote: `/Users/tristankennedy/.codex/generated_images/019ea37b-6df9-7b82-a42c-a07be744155a/ig_007bcecd21ed5379016a25ca2e960c8198be9610d952686796.png`
- Results: `/Users/tristankennedy/.codex/generated_images/019ea37b-6df9-7b82-a42c-a07be744155a/ig_007bcecd21ed5379016a25ca812ff88198a8071c64f1015565.png`

Match the screenshots' hierarchy: plain white app surface, compact top chrome, strong mobile-first type, card-stack vote view, bottom persistent action, private/no-account promise.

## Engineering Constraints

- Keep the app dependency-light and VPS-friendly.
- Store production data outside the repo.
- Bind production to `127.0.0.1`; do not open a public app port.
- Keep generated databases, env files, logs, and credentials out of git.
- Prefer small focused edits. Do not introduce a parallel design system.

## Required Verification

- `npm test`
- `npm run smoke` against a running local server
- Browser check on desktop and mobile widths
- If deploying: VPS service status, loopback health check, listener check, and data path proof

## Review Guidelines

- Treat product drift as a blocking review concern when a change adds planning-dashboard behavior, accounts, chat, feeds, analytics dashboards, or social mechanics that do not serve the paste/share/vote/reveal job.
- Treat public exposure of private links, SQLite data, env files, logs, or VPS internals as P0/P1.
- Treat production listener changes away from `127.0.0.1` as P0 unless explicitly requested.
- Treat missing `npm test` and local smoke evidence as a review gap for behavioral changes.
- Treat missing browser evidence as a review gap for UI changes.
- Treat missing VPS service, health, listener, and data-path evidence as a review gap for deployment changes.

## RepoPrompt Fleet Contract

- Parent Codex owns the overall goal and orchestrates the RepoPrompt Orchestrator.
- One Orchestrator agent may edit and coordinate implementation.
- One Critic agent is read-only and only looks for failure modes.
- Max iterations: 5. Stop and report rather than looping.
- PR must describe what was built, what was verified, and what remains.
- Do not treat an Orchestrator completion message as final closure until parent Codex verifies browser evidence, repo/PR state, and VPS status.
