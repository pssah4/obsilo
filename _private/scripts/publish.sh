#!/bin/bash
# publish.sh — Build and push clean public release to obsilo
# Usage: bash devprocess/scripts/publish.sh [--dry-run]
#
# What this does:
#   1. Runs npm build
#   2. Pushes current branch to obsilo/main
#
# Private files (devprocess/, .claude/, .kilocode/, forked-kilocode/)
# are gitignored and will NOT appear in the public repo.

set -e

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[dry-run] No changes will be pushed"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $CURRENT_BRANCH"

# Verify no private files are staged
PRIVATE_STAGED=$(git diff --cached --name-only | grep -E '^devprocess/' || true)
if [[ -n "$PRIVATE_STAGED" ]]; then
  echo "ERROR: Private files are staged for commit:"
  echo "$PRIVATE_STAGED"
  exit 1
fi

# Build
echo ""
echo "Building plugin..."
npm run build
echo "Build complete."

# Show what will be published
echo ""
echo "Files that will be in obsilo/main:"
git ls-files | head -60
echo ""

# Push
if [[ "$DRY_RUN" == "false" ]]; then
  echo "Pushing to obsilo/main..."
  git push --force obsilo "${CURRENT_BRANCH}:main"
  echo ""
  echo "Done. obsilo/main updated from branch: $CURRENT_BRANCH"
else
  echo "[dry-run] Would run: git push --force obsilo ${CURRENT_BRANCH}:main"
fi
