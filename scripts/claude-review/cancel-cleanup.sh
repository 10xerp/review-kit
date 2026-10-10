#!/usr/bin/env bash
# Restores the previous review comment when a run is cancelled while Claude's progress placeholder
# is showing.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$0")/lib.sh"

comment_id="$(state prior_comment_id)"
body_file="$(state prior_body_file)"
if [[ -z "$comment_id" || ! -s "$body_file" ]]; then
  echo "No prior review to restore."
  exit 0
fi

current=$(gh api "repos/$GITHUB_REPOSITORY/issues/comments/$comment_id" --jq .body)
if [[ "$current" != *"Claude Code is working"* && "$current" != *"In progress"* ]]; then
  echo "Comment no longer a working placeholder; leaving as-is."
  exit 0
fi

jq -n --rawfile body "$body_file" '{body: $body}' > "$WORK/restore.json"
gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$comment_id" --input "$WORK/restore.json" --silent
echo "Restored prior review comment after cancellation."
