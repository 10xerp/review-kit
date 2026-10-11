#!/usr/bin/env bash
# Stamps finding IDs and review metadata on the sticky comment, writes the review record and fails
# the check when the review is Blocked.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$0")/lib.sh"

PR_NUMBER="$(state pr)"
HEAD_SHA="$(state head_sha)"

if [[ "$(state skip_model)" != true ]]; then
  phase model_done
  if [[ ! -s "${EXECUTION_FILE:-}" ]]; then
    fail "No review verdict for this run. Re-run the workflow."
  fi
fi

fetch_comments "$PR_NUMBER" > "$WORK/comments-final.json"
phase finalize_done
result="$(COMMIT_TIME="$(git show -s --format=%cI "$HEAD_SHA")" \
  cli finalize "$STATE" "$WORK/comments-final.json" "$PHASES" "$WORK")"
verdict="$(jq -r .verdict <<< "$result")"
summary="$(jq -r .summary <<< "$result")"
review_source="$(jq -r .source <<< "$result")"

if [[ "$(jq -r .patch_comment <<< "$result")" == true ]]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$(jq -r .comment_id <<< "$result")" \
    --input "$WORK/comment.json" --silent
fi
output verdict "$verdict"
output record_path "$WORK/review-record.json"
step_summary "## Claude review: ${summary}"
if [[ "$(jq -r .comment_length <<< "$result")" != 0 ]]; then
  step_summary "Head \`${HEAD_SHA::7}\`, mode \`${review_source}\`, comment $(jq -r .comment_length <<< "$result") chars."
fi

[[ "$verdict" != blocked ]] || fail "Claude review: Blocked (must-fix Issues). See the PR comment."
if [[ "$review_source" == carry_forward ]]; then
  echo "Review verdict (carry-forward): $summary"
else
  echo "Review verdict: $summary"
fi
