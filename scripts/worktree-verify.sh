#!/usr/bin/env sh
set -eu

sh scripts/worktree-guard.sh

echo "Running per-worktree verification..."
npm test -- --passWithNoTests
npm run build

echo "Worktree verification passed."
