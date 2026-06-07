# Agent Orchestration

RepoPrompt is the coordination layer for this project.

## Workspace

- RepoPrompt window: `2`
- Project path: `/Users/tristankennedy/Desktop/CODEX/swipe-shortlist`

## Fleet

- Orchestrator: edits code, runs tests, incorporates Critic feedback, prepares the PR.
- Critic: read-only. Looks only for failure modes in UX, product scope, API behavior, persistence, deployment posture, and PR readiness.

## Iteration Cap

Maximum 5 iterations per agent run. If the same blocker repeats, stop and report it with exact evidence.

## Orchestrator Prompt Shape

```text
You are the Orchestrator for SwipeShortlist. Implement the fullstack app against AGENTS.md, memory/PROJECT_MEMORY.md, docs/source-of-truth.md, and the V3 screenshots. Use max 5 iterations. Run npm test and npm run smoke. Include Critic findings. Commit changes, push a feature branch, and create a PR when complete.
```

## Critic Prompt Shape

```text
You are the Critic for SwipeShortlist. Do not edit files. Find failure modes only: product drift, hidden complexity, social-pressure bugs, broken mobile layout, API/persistence bugs, private VPS exposure, GitHub/PR gaps. Max 5 passes. Return blockers first with file references.
```
