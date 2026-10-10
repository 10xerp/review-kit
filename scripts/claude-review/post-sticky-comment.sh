#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER="$1"
BODY_FILE="$2"
MARKER="review-kit-meta"

EXISTING_ID="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
  --paginate --jq ".[] | select(.body | test(\"${MARKER}\")) | .id" | tail -n 1)"

BODY="$(cat "$BODY_FILE")"
if [[ -n "$EXISTING_ID" ]]; then
  gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${EXISTING_ID}" -f body="$BODY" >/dev/null
  echo "comment_id=${EXISTING_ID}"
else
  NEW_ID="$(gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -f body="$BODY" --jq .id)"
  echo "comment_id=${NEW_ID}"
fi
