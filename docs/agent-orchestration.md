# Agent Orchestration

RepoPrompt is the coordination layer for this project. The parent Codex thread owns the goal and orchestrates the RepoPrompt Orchestrator.

## Goal Model

The goal model has three layers:

1. Parent Codex goal owner: keeps the product objective, current user instruction, verification boundaries, VPS posture, and final status honest.
2. RepoPrompt Orchestrator: executes bounded implementation work, incorporates Critic feedback, commits, pushes, and opens/updates the PR.
3. Critic: read-only failure-mode agent. It can block work with evidence, but it does not edit files or widen scope.

The parent Codex thread is the only layer that can declare the overall goal complete or blocked. The Orchestrator may report "done" for its assigned run, but parent Codex must still verify repo state, PR state, browser behavior, and VPS/deployment status before final closure.

## Workspace

- RepoPrompt window: do not assume a stable id. Use `manage_workspaces action=switch workspace=swipe-shortlist open_in_new_window=true`, then route with the returned `_windowID`.
- Project path: `/Users/tristankennedy/Desktop/CODEX/swipe-shortlist`

## Fleet

- Orchestrator: edits code, runs tests, incorporates Critic feedback, prepares or updates the PR.
- Critic: read-only. Looks only for failure modes in UX, product scope, API behavior, persistence, deployment posture, and PR readiness.
- Parent Codex: launches/polls/responds to agents, handles approvals, checks final evidence, and deploys or reports deployment blockers.

## Iteration Cap

Maximum 5 iterations per agent run. If the same blocker repeats, stop and report it with exact evidence.

## Approval Rules

- Allow narrow browser verification approvals when they are required for desktop/mobile proof.
- Do not approve destructive repo, VPS, firewall, credential, or public-exposure changes without explicit user confirmation.
- Keep repeated approvals scoped to the active agent session and exact verification target.
- If RepoPrompt loses a detached control handle, relaunch as a blocking run or poll immediately; do not leave active agents unattended.

## Orchestrator Prompt Shape

```text
You are the Orchestrator for SwipeShortlist. Implement the fullstack app against AGENTS.md, memory/PROJECT_MEMORY.md, docs/source-of-truth.md, and the V3 screenshots. Use max 5 iterations. Run npm test and npm run smoke. Include Critic findings. Commit changes, push a feature branch, and create a PR when complete.
```

## Critic Prompt Shape

```text
You are the Critic for SwipeShortlist. Do not edit files. Find failure modes only: product drift, hidden complexity, social-pressure bugs, broken mobile layout, API/persistence bugs, private VPS exposure, GitHub/PR gaps. Max 5 passes. Return blockers first with file references.
```

## Parent Codex Closure Checklist

- Repo clean or intentionally dirty with explanation.
- PR URL exists and points from feature branch to `main`.
- `npm test` passed.
- `npm run smoke` passed against a running local server.
- Browser proof covers create, vote, result, direct result gating, mobile, and desktop.
- VPS status is verified from the intended private path, or the blocker is reported exactly.
