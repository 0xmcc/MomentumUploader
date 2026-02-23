#!/usr/bin/env sh
set -eu

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  echo "Not inside a git repository."
  exit 1
fi

current_dir="$(pwd)"
current_branch="$(git branch --show-current 2>/dev/null || true)"

default_branch="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
default_branch="${default_branch#origin/}"
if [ -z "$default_branch" ]; then
  default_branch="main"
fi

if [ -z "$current_branch" ]; then
  echo "Detached HEAD is not allowed for active agent work."
  echo "Create a branch: git switch -c agent-session-<slug>"
  exit 1
fi

if [ "$current_dir" = "$repo_root" ]; then
  if [ "$current_branch" != "$default_branch" ]; then
    echo "Root checkout must stay on '$default_branch'."
    echo "Current branch is '$current_branch'."
    echo "Create a worktree instead:"
    echo "  git worktree add ../wt-<slug> -b agent-session-<slug>"
    exit 1
  fi
else
  case "$current_branch" in
    agent-session-*)
      ;;
    *)
      echo "Worktree branch must match 'agent-session-*'."
      echo "Current branch is '$current_branch'."
      echo "Rename or recreate with:"
      echo "  git switch -c agent-session-<slug>"
      exit 1
      ;;
  esac
fi

echo "Worktree guard passed: $current_branch"
