#!/usr/bin/env bash
# Build for amd64 and push to Docker Hub. Pushes two tags: :latest and :<short-sha>.
# Re-renders the Unraid XML.
#
# Reads from env (.envrc): DOCKER_USER, IMAGE_NAME, optional DOCKER_TOKEN.
set -euo pipefail

: "${DOCKER_USER:?source .envrc first (copy from .envrc.example)}"
: "${IMAGE_NAME:?source .envrc first}"

REPO="$DOCKER_USER/$IMAGE_NAME"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not in a git repo. Deploy script tags from git." >&2
  exit 1
fi

SHA=$(git rev-parse --short HEAD)

# Refuse to publish a SHA tag that doesn't match the working tree, unless overridden.
if [ -n "$(git status --porcelain)" ]; then
  if [ "${ALLOW_DIRTY:-0}" != "1" ]; then
    echo "Working tree is dirty. The :$SHA tag would not match HEAD." >&2
    echo "Commit/stash, or set ALLOW_DIRTY=1 to push anyway (the SHA tag will lie)." >&2
    exit 1
  fi
  echo "WARNING: ALLOW_DIRTY=1 — pushing :$SHA from a dirty tree."
fi

if [ -n "${DOCKER_TOKEN:-}" ]; then
  echo "Logging in to Docker Hub as $DOCKER_USER"
  echo "$DOCKER_TOKEN" | docker login -u "$DOCKER_USER" --password-stdin
fi

echo "Building and pushing $REPO:latest + $REPO:$SHA (linux/amd64)"
docker buildx build \
  --platform=linux/amd64 \
  -f tools/Dockerfile \
  -t "$REPO:latest" \
  -t "$REPO:$SHA" \
  --push \
  .

echo
echo "Deployed $REPO:$SHA and tagged as :latest"
