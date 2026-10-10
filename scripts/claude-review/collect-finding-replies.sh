#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER="$1"
OUT_JSON="$2"

gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --paginate \
  | node "${REVIEW_KIT_ACTION_PATH}/scripts/claude-review/comments-to-replies.mjs" > "$OUT_JSON"
