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
# A PR that changes the workflow running this review, or whose copy of it differs from the base
# branch, gets no model run: claude-code-action refuses to start then. The check fails and a person
# merges such a PR with an explicit, logged bypass.
write_tooling_record() {
  local skip_reason="$1"
  fetch_comments "$PR_NUMBER" > "$WORK/comments.json"
  local standards_sha=""
  if git show "$BASE:$STANDARDS_PATH" > "$WORK/standards.md" 2> /dev/null; then
    standards_sha="$(sha256sum "$WORK/standards.md" | cut -c1-64)"
  fi
  cli tooling-record "$WORK" "$skip_reason" "$PR_NUMBER" "$HEAD_SHA" "$PR_BASE" "$BASE_SHA" \
    "$RUN_STARTED" "$JOB_STARTED" "$standards_sha" "$WORK/comments.json" > /dev/null
  output record_path "$WORK/review-record.json"
}

tooling_unreviewed() {
  local title="$1"
  local summary="$2"
  local skip_reason="$3"
  step_summary "## Claude review: not run ($title)"
  step_summary "$summary"
  output review false
  output verdict skipped
  write_tooling_record "$skip_reason"
  fail "$summary Model skipped. The check fails: a maintainer reviews and merges this PR with an explicit bypass, or merge origin/$PR_BASE if only the base moved."
}

SCOPE="$(git diff --name-only "$BASE...HEAD" | cli scope "$WORKFLOW_PATH")"
if [[ "$(jq -r .review <<< "$SCOPE")" != true ]]; then
  if [[ "$(jq -r .changes_review_tooling <<< "$SCOPE")" == true ]]; then
    tooling_unreviewed "review tooling changed" "This PR changes the review workflow ($WORKFLOW_PATH)." "review workflow changed"
  fi
  step_summary "## Claude review: skipped (scope)"
  if [[ "$(jq -r .images_only_skip <<< "$SCOPE")" == true ]]; then
    step_summary "This PR only changes images."
    echo "::notice::No review: images only."
  else
    step_summary "This PR only changes docs or images."
    echo "::notice::No review: docs or images only."
  fi
  skip
fi

if git cat-file -e "$BASE:$WORKFLOW_PATH" 2> /dev/null || git cat-file -e "HEAD:$WORKFLOW_PATH" 2> /dev/null; then
  if ! git cat-file -e "$BASE:$WORKFLOW_PATH" 2> /dev/null || ! git cat-file -e "HEAD:$WORKFLOW_PATH" 2> /dev/null ||
    ! git diff --quiet "$BASE:$WORKFLOW_PATH" "HEAD:$WORKFLOW_PATH" 2> /dev/null; then
    tooling_unreviewed "workflow differs from default branch" "The review workflow ($WORKFLOW_PATH) on this PR differs from $PR_BASE." "workflow differs from default branch"
  fi
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
  # That covers the root files, every nested CLAUDE.md, and nested .claude/ trees Claude Code loads.
  claude_dir_paths() {
    local ref="$1"
    while IFS= read -r -d '' p; do
      if [[ "$p" == .claude/* ]]; then
        printf '%s\0' .claude
      elif [[ "$p" == */.claude/* ]]; then
        printf '%s\0' "${p%%/.claude/*}/.claude"
      fi
    done < <(git ls-tree -r -z --name-only "$ref" | grep -zE '(^|/)\.claude/' || true)
  }
  mapfile -d '' -t instruction_paths < <({
    printf '%s\0' .claude CLAUDE.md CLAUDE.local.md
    git ls-tree -r -z --name-only HEAD | grep -zE '(^|/)CLAUDE(\.local)?\.md$' || true
    git ls-tree -r -z --name-only "$BASE" | grep -zE '(^|/)CLAUDE(\.local)?\.md$' || true
    claude_dir_paths HEAD
    claude_dir_paths "$BASE"
  } | sort -zu)
  for path in "${instruction_paths[@]}"; do
    rm -rf "$path"
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
