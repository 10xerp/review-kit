#!/usr/bin/env bash
# Restores the previous review comment when a run is cancelled while Claude's progress placeholder
# is showing. With per-run comments (the default, sticky_comment: false) the earlier review was untouched,
# so this run's placeholder is deleted instead.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$0")/lib.sh"

if [[ "${INPUT_STICKY_COMMENT:-false}" != true ]]; then
  fetch_comments "$(state pr)" > "$WORK/comments-cancel.json"
  ids=$(jq -r --arg bot "claude[bot]" --arg since "$(state run_started)" '.[]
    | select(.user.login == $bot and .created_at >= $since)
    | select((.body | contains("Claude Code is working")) or (.body | contains("In progress")))
    | .id' "$WORK/comments-cancel.json")
  if [[ -z "$ids" ]]; then
    echo "No placeholder from this run to remove."
    exit 0
  fi
  for id in $ids; do
    gh api --method DELETE "repos/$GITHUB_REPOSITORY/issues/comments/$id" --silent
  done
  echo "Removed this run's progress placeholder after cancellation."
  exit 0
fi

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
