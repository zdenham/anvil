#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKTREE_ROOT="$(dirname "$SCRIPT_DIR")"

# Auto-detect main worktree (first entry in git worktree list) or use arg
if [ -n "$1" ]; then
  MAIN_WORKTREE="$1"
else
  MAIN_WORKTREE="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
fi

echo "Setting up worktree at: $WORKTREE_ROOT"
echo "Copying .env from: $MAIN_WORKTREE"

# 1. Copy .env (skip if already present or if this IS the main worktree)
if [ "$WORKTREE_ROOT" = "$MAIN_WORKTREE" ]; then
  echo "This is the main worktree, skipping .env copy"
elif [ -f "$WORKTREE_ROOT/.env" ]; then
  echo ".env already exists, skipping copy"
elif [ ! -f "$MAIN_WORKTREE/.env" ]; then
  echo "ERROR: No .env found at $MAIN_WORKTREE/.env"
  echo "Usage: pnpm setup [path-to-main-worktree]"
  exit 1
else
  cp "$MAIN_WORKTREE/.env" "$WORKTREE_ROOT/.env"
fi

# 2. Install all dependencies
cd "$WORKTREE_ROOT"
pnpm install

SUBPACKAGES=(agents core/sdk migrations api server)
for pkg in "${SUBPACKAGES[@]}"; do
  if [ -f "$pkg/package.json" ]; then
    echo "Installing $pkg..."
    (cd "$pkg" && pnpm install)
  fi
done

echo "Setup complete. Run 'pnpm dev' to start."
