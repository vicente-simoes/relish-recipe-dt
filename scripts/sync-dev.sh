#!/usr/bin/env bash
# Copy this working tree, including uncommitted changes, to a test copy on the workstation. Usage: bash scripts/sync-dev.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HOST="${SYNC_HOST:-iti-workstation}"
DEST="${SYNC_DEST:-/home/vicente/projects/relish-dev}"
# The workstation's SSH server lands in Windows, so rsync runs through WSL
RSYNC_PATH="${SYNC_RSYNC_PATH:-wsl rsync}"

INFO_DIR=$(mktemp -d)
trap 'rm -rf "$INFO_DIR"' EXIT

# Uncommitted changes, including new files, so runs can be traced back to the exact code
cd "$REPO_DIR"
{
  git diff HEAD
  git ls-files -o --exclude-standard | while IFS= read -r f; do git diff --no-index -- /dev/null "$f" || true; done
} >"$INFO_DIR/.sync-diff.patch"
SYNC_COMMIT=$(git rev-parse HEAD) SYNC_BRANCH=$(git rev-parse --abbrev-ref HEAD) \
  SYNC_CHANGED=$(git status --porcelain) python3 - "$INFO_DIR/.sync-diff.patch" >"$INFO_DIR/.sync-info.json" <<'EOF'
import datetime, hashlib, json, os, sys

patch = open(sys.argv[1], "rb").read()
print(json.dumps({
    "syncedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "baseCommit": os.environ["SYNC_COMMIT"],
    "branch": os.environ["SYNC_BRANCH"],
    "changedFiles": os.environ["SYNC_CHANGED"].splitlines(),
    "diffSha256": hashlib.sha256(patch).hexdigest(),
}, indent=2))
EOF

# Excluded paths are also kept on the workstation side (.env and generated are links to the main checkout)
rsync -a --delete --rsync-path="$RSYNC_PATH" \
  --exclude .git --exclude node_modules --exclude /tmp --exclude generated \
  --exclude bin --exclude dist --exclude .DS_Store \
  --include .env.example --exclude '*.env*' --exclude keyfile --exclude passwordFile --exclude pwfile \
  --exclude CLAUDE.md --exclude '/benchmark/pilot-*' --exclude /notes --exclude /.claude \
  --exclude /.sync-info.json --exclude /.sync-diff.patch \
  "$REPO_DIR/" "$HOST:$DEST/"
rsync -a --rsync-path="$RSYNC_PATH" "$INFO_DIR/.sync-info.json" "$INFO_DIR/.sync-diff.patch" "$HOST:$DEST/"

echo "Synced to $HOST:$DEST (base $(git rev-parse --short HEAD), $(git status --porcelain | wc -l) changed files)"
