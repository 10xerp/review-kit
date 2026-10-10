#!/usr/bin/env bash
# Decides whether and how to review the PR, and writes the prompt for Claude.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$0")/lib.sh"

STANDARDS_PATH=".claude/skills/review-standards/SKILL.md"
rm -rf "$WORK"
mkdir -p "$WORK"
RUN_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
JOB_STARTED="$(date +%s)"
echo "{\"job_started\": $JOB_STARTED}" > "$PHASES"

skip() {
  output review false
  output verdict skipped
  exit 0
}

[[ "${GITHUB_EVENT_NAME:-}" == pull_request ]] || fail "review-kit runs on pull_request events only"
EVENT="${GITHUB_EVENT_PATH:?}"
PR_NUMBER="$(jq -r '.pull_request.number' "$EVENT")"
HEAD_SHA="$(jq -r '.pull_request.head.sha' "$EVENT")"
PR_BASE="$(jq -r '.pull_request.base.ref' "$EVENT")"
EVENT_ACTION="$(jq -r '.action // empty' "$EVENT")"

if [[ "$(jq -r '.pull_request.draft' "$EVENT")" == true ]]; then
  step_summary "## Claude review: skipped (draft PR)"
  echo "::notice::Draft PR: automated Claude review skipped."
  skip
fi

git fetch -q origin "$PR_BASE" --no-tags
git -c advice.detachedHead=false checkout -q --detach "$HEAD_SHA"
BASE="origin/${PR_BASE}"
BASE_SHA="$(git rev-parse "$BASE")"

WORKFLOW_PATH="${GITHUB_WORKFLOW_REF:?}"
WORKFLOW_PATH="${WORKFLOW_PATH%@*}"
WORKFLOW_PATH="${WORKFLOW_PATH#"$GITHUB_REPOSITORY"/}"
SCOPE="$(git diff --name-only "$BASE...HEAD" | cli scope "$WORKFLOW_PATH")"
if [[ "$(jq -r .review <<< "$SCOPE")" != true ]]; then
  step_summary "## Claude review: skipped (scope)"
  if [[ "$(jq -r .changes_review_tooling <<< "$SCOPE")" == true ]]; then
    step_summary "This PR changes the review workflow ($WORKFLOW_PATH), so the model is skipped."
    echo "::notice::Review tooling changed on PR: model skipped (check passes)."
  else
    step_summary "This PR only changes docs or images."
    echo "::notice::No review: docs or images only."
  fi
  skip
fi

git show "$BASE:$STANDARDS_PATH" > "$WORK/standards.md" 2> /dev/null ||
  fail "$STANDARDS_PATH is missing on $PR_BASE"
STANDARDS_SHA="$(sha256sum "$WORK/standards.md" | cut -c1-64)"

fetch_comments "$PR_NUMBER" > "$WORK/comments.json"
cli prior "$WORK/comments.json" "$WORK/prior-body.md" > "$WORK/prior.json"
last_sha="$(jq -r .last_sha "$WORK/prior.json")"

full_review=false
case "$EVENT_ACTION" in
  opened | ready_for_review | reopened) full_review=true ;;
esac
if [[ -n "$last_sha" ]] && ! git cat-file -e "$last_sha^{commit}" 2> /dev/null; then
  echo "::notice::Last reviewed commit ${last_sha::7} is no longer in the history; running a full review."
  full_review=true
fi

skip_model=false
review_mode="full"
diff_instruction="git diff ${BASE}...HEAD"

pr_merge_base() { git merge-base "$BASE" "$1"; }
pr_patch_at() { git diff "$(pr_merge_base "$1")" "$1"; }
pr_files_at() { git diff --name-only "$(pr_merge_base "$1")" "$1"; }

if [[ "$full_review" == "true" || -z "$last_sha" ]]; then
  review_mode="full"
else
  review_mode="incremental"
  patch_at_last=$(pr_patch_at "$last_sha")
  patch_at_head=$(pr_patch_at "$HEAD_SHA")

  if [[ "$last_sha" == "$HEAD_SHA" || "$patch_at_last" == "$patch_at_head" ]]; then
    skip_model=true
    review_mode="carry_forward"
  else
    mapfile -t pr_files < <({
      pr_files_at "$last_sha"
      pr_files_at "$HEAD_SHA"
    } | sort -u)
    incr_files=()
    for f in "${pr_files[@]}"; do
      [[ -z "$f" ]] && continue
      old_hunk=$(git diff "$(pr_merge_base "$last_sha")" "$last_sha" -- "$f" 2> /dev/null || true)
      new_hunk=$(git diff "$(pr_merge_base "$HEAD_SHA")" "$HEAD_SHA" -- "$f" 2> /dev/null || true)
      [[ "$old_hunk" != "$new_hunk" ]] && incr_files+=("$f")
    done
    if [[ ${#incr_files[@]} -eq 0 ]]; then
      skip_model=true
      review_mode="carry_forward"
    else
      quoted=$(printf '%q ' "${incr_files[@]}")
      diff_instruction="git diff ${last_sha}..HEAD -- ${quoted% }"
    fi
  fi
fi

jq \
  --arg pr "$PR_NUMBER" \
  --arg head_sha "$HEAD_SHA" \
  --arg base_ref "$PR_BASE" \
  --arg base_sha "$BASE_SHA" \
  --arg review_mode "$review_mode" \
  --argjson skip_model "$skip_model" \
  --arg diff_instruction "$diff_instruction" \
  --arg prior_body_file "$WORK/prior-body.md" \
  --arg standards_sha256 "$STANDARDS_SHA" \
  --arg run_started "$RUN_STARTED" \
  --argjson job_started "$JOB_STARTED" \
  '. + $ARGS.named' "$WORK/prior.json" > "$STATE"

output review true
output skip_model "$skip_model"
output prior_comment_id "$(state prior_comment_id)"

if [[ "$skip_model" == true ]]; then
  echo "::notice::Carry-forward review (no model run)."
else
  # Claude may only load repo instructions and config from the base branch, never the PR head.
  rm -rf .claude CLAUDE.md
  for path in .claude CLAUDE.md; do
    if git cat-file -e "$BASE:$path" 2> /dev/null; then
      git checkout -q "$BASE" -- "$path"
    fi
  done
  delimiter="CLAUDE_REVIEW_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  {
    echo "prompt<<$delimiter"
    cli prompt "$STATE" "$WORK/standards.md"
    echo "$delimiter"
  } >> "$GITHUB_OUTPUT"
fi

phase prep_done
