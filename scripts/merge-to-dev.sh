#!/bin/bash
#
# merge-to-dev.sh — Safe merge workflow with automatic backup
#
# Usage: ./scripts/merge-to-dev.sh <feature-branch>
#
# Workflow:
#   1. Fast-forward dev-backup to current dev (safety snapshot)
#   2. Merge <feature-branch> into dev
#
# If the merge fails, dev-backup still holds the pre-merge state.
# To restore: git checkout dev && git reset --hard dev-backup
#

set -euo pipefail

FEATURE="${1:-}"

if [[ -z "$FEATURE" ]]; then
    echo "Usage: ./scripts/merge-to-dev.sh <feature-branch>"
    echo ""
    echo "Example: ./scripts/merge-to-dev.sh security-fixes"
    exit 1
fi

# Verify branches exist
if ! git rev-parse --verify "$FEATURE" >/dev/null 2>&1; then
    echo "Error: Branch '$FEATURE' does not exist."
    exit 1
fi

if ! git rev-parse --verify dev >/dev/null 2>&1; then
    echo "Error: Branch 'dev' does not exist."
    exit 1
fi

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Error: You have uncommitted changes. Commit or stash them first."
    exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)

echo "=== merge-to-dev: $FEATURE -> dev ==="
echo ""

# Step 1: Backup dev -> dev-backup
echo "[1/3] Backing up dev -> dev-backup ..."
git checkout dev-backup --quiet
git merge dev --ff-only --quiet
DEV_BACKUP_SHA=$(git rev-parse --short dev-backup)
echo "      dev-backup is now at $DEV_BACKUP_SHA"
echo ""

# Step 2: Merge feature -> dev
echo "[2/3] Merging $FEATURE -> dev ..."
git checkout dev --quiet
if git merge "$FEATURE" --no-ff -m "Merge branch '$FEATURE' into dev

Backup: dev-backup at $DEV_BACKUP_SHA before this merge."; then
    DEV_SHA=$(git rev-parse --short dev)
    echo "      dev is now at $DEV_SHA"
    echo ""
    echo "[3/3] Done."
    echo ""
    echo "  dev-backup: $DEV_BACKUP_SHA (pre-merge snapshot)"
    echo "  dev:        $DEV_SHA (after merge)"
    echo ""
    echo "  To undo: git checkout dev && git reset --hard dev-backup"
else
    echo ""
    echo "ERROR: Merge conflict! Resolve conflicts, then:"
    echo "  git add . && git commit"
    echo ""
    echo "  To abort: git merge --abort"
    echo "  To restore: git reset --hard dev-backup"
    exit 1
fi
