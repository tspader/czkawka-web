#!/usr/bin/env bash

# Builds a statically linked czkawka binary from the pinned CZKAWKA_REV plus czkawka.patch

set -euo pipefail

# Be sure to update the Czkawka revision and the patch together
CZKAWKA_REPO="https://github.com/qarmin/czkawka.git"
CZKAWKA_REV="b5b454af543f8f8ecb8e43c1db901766c200cbeb"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$REPO_ROOT/build/czkawka"
PATCH_FILE="$REPO_ROOT/tools/czkawka.patch"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo not found on PATH" >&2
  exit 1
fi

# Clone and make sure we have the desired revision
if [ ! -d "$SRC_DIR/.git" ]; then
  echo "==> Cloning $CZKAWKA_REPO into $SRC_DIR"
  mkdir -p "$(dirname "$SRC_DIR")"
  git clone "$CZKAWKA_REPO" "$SRC_DIR"
fi

cd "$SRC_DIR"

if ! git cat-file -e "${CZKAWKA_REV}^{commit}" 2>/dev/null; then
  echo "==> Fetching from origin"
  git fetch origin
fi

# Check out the revision and apply the patch
echo "==> Preparing Czkawka source"
if [ "$(git rev-parse HEAD 2>/dev/null)" != "$CZKAWKA_REV" ] || ! git apply --reverse --check "$PATCH_FILE" >/dev/null 2>&1; then
  echo "==> Checking out $CZKAWKA_REV and applying patch"
  git checkout -f --detach "$CZKAWKA_REV"
  git clean -fd
  git apply "$PATCH_FILE"
fi

# Build and strip
echo "==> Building czkawka_cli (release)"
cargo build --release -p czkawka_cli

echo "==> Stripping czkawka_cli"
strip "$SRC_DIR/target/release/czkawka_cli"

echo
echo "Built $SRC_DIR/target/release/czkawka_cli"
