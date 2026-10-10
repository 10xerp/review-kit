#!/usr/bin/env bash
# Reviews the current pull request with Claude Code, updates the sticky review comment,
# writes the review record and fails when the verdict is blocked.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${RUNNER_TEMP:?}/claude-review"
STANDARDS_PATH=".claude/skills/review-standards/SKILL.md"
: "${ANTHROPIC_API_KEY:?anthropic_api_key is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

rm -rf "$WORK"
mkdir -p "$WORK"

cli() { node "$KIT/cli.mjs" "$@"; }
fail() { echo "::error::$*" >&2; exit 1; }
output() { echo "$1=$2" >> "${GITHUB_OUTPUT:?}"; }
now_ms() { date +%s%3N; }
START="$(now_ms)"
PHASES='{}'
phase() { PHASES="$(jq -c --arg k "$1" --argjson v "$(($(now_ms) - $2))" '.[$k] = $v' <<< "$PHASES")"; }

# finish VERDICT [RESULT_JSON]
finish() {
  phase total "$START"
  echo "$PHASES" > "$WORK/phases.json"
  cli record "$WORK/context.json" "$WORK/phases.json" "${@:2}" > "$WORK/record.json"
  cli summary "$WORK/record.json" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  output verdict "$1"
  output record_path "$WORK/record.json"
  if [[ "$1" == blocked ]]; then
    fail "Review: Blocked. See the review comment on PR #$REVIEW_PR."
  fi
  echo "Review verdict: $1"
  exit 0
}

[[ "${GITHUB_EVENT_NAME:-}" == pull_request ]] || fail "review-kit runs on pull_request events only"
EVENT="${GITHUB_EVENT_PATH:?}"
export REVIEW_PR REVIEW_HEAD_SHA REVIEW_BASE_SHA REVIEW_MERGE_BASE REVIEW_MODE REVIEW_FROM_SHA=""
REVIEW_PR="$(jq -r '.pull_request.number' "$EVENT")"
if [[ "$(jq -r '.pull_request.draft' "$EVENT")" == true ]]; then
  echo "::notice::Skipping review: PR #$REVIEW_PR is a draft"
  output verdict skipped
  exit 0
fi
REVIEW_HEAD_SHA="$(jq -r '.pull_request.head.sha' "$EVENT")"
REVIEW_BASE_SHA="$(jq -r '.pull_request.base.sha' "$EVENT")"
TRUSTED_BRANCH="${INPUT_TRUSTED_BASE_BRANCH:-$(jq -r '.repository.default_branch' "$EVENT")}"

t="$(now_ms)"
gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$REVIEW_PR/comments" --jq '.[]' | jq -s . > "$WORK/comments.json"
cli context < "$WORK/comments.json" > "$WORK/context.json"
PREV_SHA="$(jq -r '.previous.head_sha // empty' "$WORK/context.json")"
phase pr_context "$t"

t="$(now_ms)"
git -c advice.detachedHead=false checkout -q --detach "$REVIEW_HEAD_SHA"
REVIEW_MERGE_BASE="$(git merge-base "$REVIEW_BASE_SHA" "$REVIEW_HEAD_SHA")" ||
  fail "Cannot find the merge base of the PR; check out with fetch-depth: 0"
mapfile -d '' -t FILES < <(git diff -z --name-only "$REVIEW_MERGE_BASE" "$REVIEW_HEAD_SHA")
printf '%s\n' "${FILES[@]}" > "$WORK/files.txt"

if [[ "$PREV_SHA" == "$REVIEW_HEAD_SHA" && "${GITHUB_RUN_ATTEMPT:-1}" == 1 ]]; then
  REVIEW_MODE=reused
  REVIEW_FROM_SHA="$PREV_SHA"
elif [[ -n "$PREV_SHA" && "$PREV_SHA" != "$REVIEW_HEAD_SHA" ]] &&
  git merge-base --is-ancestor "$PREV_SHA" "$REVIEW_HEAD_SHA" 2> /dev/null; then
  REVIEW_MODE=incremental
  REVIEW_FROM_SHA="$PREV_SHA"
  if ((${#FILES[@]} > 0)); then
    git diff "$PREV_SHA" "$REVIEW_HEAD_SHA" -- "${FILES[@]}" > "$WORK/diff.patch"
  fi
  [[ -s "$WORK/diff.patch" ]] || REVIEW_MODE=reused
else
  REVIEW_MODE=full
  git diff "$REVIEW_MERGE_BASE" "$REVIEW_HEAD_SHA" > "$WORK/diff.patch"
fi
phase diff "$t"

if [[ "$REVIEW_MODE" == reused ]]; then
  echo "::notice::No PR changes since the review of ${PREV_SHA:0:7}; reusing its verdict"
  finish "$(jq -r '.previous.verdict' "$WORK/context.json")"
fi

t="$(now_ms)"
TRUSTED_SHA="$(git rev-parse -q --verify "refs/remotes/origin/$TRUSTED_BRANCH^{commit}")" ||
  fail "origin/$TRUSTED_BRANCH is not available; check out with fetch-depth: 0"
git show "$TRUSTED_SHA:$STANDARDS_PATH" > "$WORK/standards.md" 2> /dev/null ||
  fail "$STANDARDS_PATH is missing on $TRUSTED_BRANCH"
# Claude may only load repo instructions and config from the trusted branch, never the PR head.
rm -rf .claude CLAUDE.md
for path in .claude CLAUDE.md; do
  if git cat-file -e "$TRUSTED_SHA:$path" 2> /dev/null; then
    git checkout -q "$TRUSTED_SHA" -- "$path"
  fi
done
phase trusted_base "$t"

t="$(now_ms)"
CLAUDE_BIN="$("$KIT/install-claude.sh")"
phase install_claude "$t"

cli prompt "$WORK/context.json" "$WORK/standards.md" "$WORK/diff.patch" "$WORK/files.txt" > "$WORK/prompt.md"
CLAUDE_ARGS=(-p --restricted --strict-mcp-config --tools "Read,Grep,Glob"
  --max-turns "${INPUT_MAX_TURNS:?}" --output-format json)
if [[ -n "${INPUT_MODEL:-}" ]]; then
  CLAUDE_ARGS+=(--model "$INPUT_MODEL")
fi
t="$(now_ms)"
env -u GH_TOKEN -u GITHUB_TOKEN "$CLAUDE_BIN" "${CLAUDE_ARGS[@]}" < "$WORK/prompt.md" > "$WORK/claude.json" ||
  fail "Claude Code exited with status $?"
phase claude "$t"

VERDICT="$(cli finalize "$WORK/claude.json" "$WORK/context.json" "$WORK")"
if grep -qF -- "$ANTHROPIC_API_KEY" "$WORK/comment.md"; then
  fail "Refusing to post a review comment that contains the Anthropic API key"
fi

t="$(now_ms)"
STICKY_ID="$(jq -r '.sticky_comment_id // empty' "$WORK/context.json")"
jq -n --rawfile body "$WORK/comment.md" '{body: $body}' > "$WORK/comment.json"
if [[ -n "$STICKY_ID" ]]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$STICKY_ID" --input "$WORK/comment.json" --silent
else
  gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$REVIEW_PR/comments" --input "$WORK/comment.json" --silent
fi
phase comment "$t"

finish "$VERDICT" "$WORK/result.json"
