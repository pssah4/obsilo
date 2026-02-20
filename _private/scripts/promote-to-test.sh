#!/usr/bin/env bash
# promote-to-test.sh
#
# Merges dev into test and removes internal-only files/dirs that
# must not appear in the public open-source release.
# Pushes to both origin (private backup) and obsilo-public (public release).
#
# Usage:  bash scripts/promote-to-test.sh
#
# Prerequisites:
#   - Clean working tree (no uncommitted changes)
#   - Remotes named "origin" and "obsilo-public"

set -euo pipefail

# ── Files and directories to strip from test/main ──────────────────────────
# Add paths here whenever a new internal file/dir is created on dev.
INTERNAL_PATHS=(
    ".claude"
    ".kilocode"
    "docs"
    "forked-kilocode"
    "scripts"          # this script itself — not needed in public release
    "memory"           # claude memory dir if present at root
)

# ── Guards ──────────────────────────────────────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
    echo "ERROR: Working tree is not clean. Commit or stash your changes first."
    exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# ── Switch to test ───────────────────────────────────────────────────────────
echo "Switching to test branch..."
git checkout test

# Pull latest test from remote (in case someone else pushed)
git pull origin test --ff-only 2>/dev/null || true

# ── Merge dev ────────────────────────────────────────────────────────────────
echo "Merging dev into test..."
git merge dev --no-ff -m "chore: promote dev to test

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

# ── Strip internal paths ─────────────────────────────────────────────────────
echo "Removing internal files from test..."
REMOVED=()
for path in "${INTERNAL_PATHS[@]}"; do
    if git ls-files --error-unmatch "$path" &>/dev/null 2>&1 || \
       git ls-files "$path" | grep -q .; then
        git rm -r --cached --ignore-unmatch "$path" >/dev/null
        # Also physically remove so they don't clutter the working tree
        rm -rf "$path"
        REMOVED+=("$path")
    fi
done

# ── Commit removal (only if anything was removed) ────────────────────────────
if [[ ${#REMOVED[@]} -gt 0 ]]; then
    echo "Removed: ${REMOVED[*]}"
    git commit -m "chore: remove internal files for public release

Removed: ${REMOVED[*]}

These paths are development-only and must not appear in test/main.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
else
    echo "Nothing to remove — internal paths were already absent."
fi

# ── Push ─────────────────────────────────────────────────────────────────────
echo "Pushing test to origin (private backup)..."
git push origin test

echo "Pushing test to obsilo-public (public release)..."
git push obsilo-public test

echo ""
echo "Done. test is now up to date and clean."
echo "  origin/test        → private backup"
echo "  obsilo-public/test → public release (https://github.com/pssah4/obsilo-public)"
echo "To return to your previous branch:  git checkout $CURRENT_BRANCH"
