#!/usr/bin/env bash
set -euo pipefail

git fetch --all --prune

echo "== remotes =="
git remote -v

echo
echo "== branches =="
git branch -vv

echo
echo "== status =="
git status --short --branch

if [ -n "$(git status --porcelain)" ]; then
  echo
  echo "Working tree has local changes."
  exit 1
fi

current_branch="$(git branch --show-current)"
upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"

if [ -z "$upstream" ]; then
  echo
  echo "Branch '$current_branch' has no upstream."
  exit 1
fi

behind_count="$(git rev-list --count "HEAD..$upstream")"
ahead_count="$(git rev-list --count "$upstream..HEAD")"

echo
echo "== sync =="
echo "branch=$current_branch"
echo "upstream=$upstream"
echo "ahead=$ahead_count"
echo "behind=$behind_count"

test "$behind_count" = "0"
