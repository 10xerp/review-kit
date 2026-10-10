#!/usr/bin/env bash
set -euo pipefail

ACTION_ROOT="${REVIEW_KIT_ACTION_PATH:?REVIEW_KIT_ACTION_PATH is required}"
PHASES_FILE="${RUNNER_TEMP}/review-kit-phases.json"
echo "{}" > "$PHASES_FILE"

phase_ms() {
  local name="$1"
  local start="$2"
  local end
  end="$(date +%s%3N)"
  local delta=$((end - start))
  local tmp
  tmp="$(mktemp)"
  jq --arg k "$name" --argjson v "$delta" '. + {($k): $v}' "$PHASES_FILE" > "$tmp"
  mv "$tmp" "$PHASES_FILE"
}

export GH_TOKEN="${INPUT_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
export ANTHROPIC_API_KEY="${INPUT_ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required}"

PR_NUMBER="${GITHUB_EVENT_PULL_REQUEST_NUMBER:-}"
if [[ -z "$PR_NUMBER" && -f "${GITHUB_EVENT_PATH:-}" ]]; then
  PR_NUMBER="$(jq -r '.pull_request.number // empty' "$GITHUB_EVENT_PATH")"
fi
if [[ -z "$PR_NUMBER" ]]; then
  echo "::error::review-kit requires a pull_request event with a PR number"
  exit 1
fi

T0="$(date +%s%3N)"
# --- skip ---
SKIP_ENV="${RUNNER_TEMP}/skip.env"
bash "${ACTION_ROOT}/scripts/claude-review/should-skip.sh" > "$SKIP_ENV"
# shellcheck disable=SC1090
source "$SKIP_ENV"
if [[ "${skip:-false}" == "true" ]]; then
  echo "verdict=skipped" >> "${GITHUB_OUTPUT:-/dev/null}"
  exit 0
fi
phase_ms "skip_check" "$T0"

T1="$(date +%s%3N)"
TRUSTED_ENV="${RUNNER_TEMP}/trusted.env"
bash "${ACTION_ROOT}/scripts/claude-review/fetch-trusted-sources.sh" > "$TRUSTED_ENV"
# shellcheck disable=SC1090
source "$TRUSTED_ENV"
STANDARDS_PATH="${review_standards_path:?}"
TRUSTED_BASE_SHA="${trusted_base_sha:?}"
phase_ms "fetch_trusted" "$T1"

T2="$(date +%s%3N)"
INSTALL_ENV="${RUNNER_TEMP}/install.env"
bash "${ACTION_ROOT}/scripts/claude-review/install-claude.sh" > "$INSTALL_ENV"
# shellcheck disable=SC1090
source "$INSTALL_ENV"
CLAUDE_BIN="${claude_executable:?}"
phase_ms "install_claude" "$T2"

HEAD_SHA="$(gh pr view "$PR_NUMBER" --json headRefOid -q .headRefOid)"
BASE_SHA="$(gh pr view "$PR_NUMBER" --json baseRefOid -q .baseRefOid)"

# Incremental: last reviewed SHA from sticky comment meta
INCREMENTAL_FROM=""
STICKY_BODY="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
  --paginate --jq '.[] | select(.body | test("review-kit-meta")) | .body' | tail -n 1 || true)"
if [[ -n "$STICKY_BODY" ]]; then
  INCREMENTAL_FROM="$(node "${ACTION_ROOT}/scripts/claude-review/read-last-reviewed-sha.mjs" "$STICKY_BODY")"
fi

DIFF_FILE="${RUNNER_TEMP}/review-kit.diff"
if [[ -n "$INCREMENTAL_FROM" && "$INCREMENTAL_FROM" != "$HEAD_SHA" ]]; then
  git diff "${INCREMENTAL_FROM}..${HEAD_SHA}" > "$DIFF_FILE" || true
else
  gh pr diff "$PR_NUMBER" > "$DIFF_FILE"
  INCREMENTAL_FROM=""
fi

REPLY_JSON="${RUNNER_TEMP}/finding-replies.json"
bash "${ACTION_ROOT}/scripts/claude-review/collect-finding-replies.sh" "$PR_NUMBER" "$REPLY_JSON"

PROMPT_FILE="${RUNNER_TEMP}/review-prompt.md"
cat > "$PROMPT_FILE" <<EOF
You are reviewing pull request #${PR_NUMBER} in ${GITHUB_REPOSITORY}.

Follow the review standards below (from the trusted default branch — not from this PR's head).

## Review standards (trusted base)
$(cat "$STANDARDS_PATH")

## Output contract
Respond with:
1. A \`\`\`json fenced block containing:
   - "verdict": one of approve | approve_with_notes | blocked
   - "summary": markdown summary for humans
   - "findings": array of { "id": "F1", "severity": "must_fix"|"should_fix"|"nit", "title", "body", "path", "line" }
2. Verdict rules:
   - blocked: any must-fix issue that should stop merge
   - approve_with_notes: only should_fix / nits
   - approve: no issues
3. Do not contradict the JSON verdict in prose.

## Incremental context
Trusted base SHA: ${TRUSTED_BASE_SHA}
Reviewed head SHA (previous): ${INCREMENTAL_FROM:-none — full PR diff}
Current head SHA: ${HEAD_SHA}

## Diff to review
\`\`\`diff
$(head -c 500000 "$DIFF_FILE")
\`\`\`
EOF

T3="$(date +%s%3N)"
CLAUDE_JSON="${RUNNER_TEMP}/claude-output.json"
set +e
"$CLAUDE_BIN" -p "$(cat "$PROMPT_FILE")" \
  --model "${INPUT_CLAUDE_MODEL:-claude-sonnet-4-5}" \
  --max-turns "${INPUT_MAX_TURNS:-40}" \
  --strict-mcp-config \
  --output-format json \
  > "$CLAUDE_JSON" 2>"${RUNNER_TEMP}/claude.stderr"
CLAUDE_EXIT=$?
set -e
phase_ms "claude_run" "$T3"

if [[ "$CLAUDE_EXIT" -ne 0 ]]; then
  echo "::error::Claude Code exited ${CLAUDE_EXIT}"
  cat "${RUNNER_TEMP}/claude.stderr" >&2 || true
  exit "$CLAUDE_EXIT"
fi

RESULT_JSON="${RUNNER_TEMP}/review-result.json"
node "${ACTION_ROOT}/scripts/claude-review/extract-review-result.mjs" "$CLAUDE_JSON" "$RESULT_JSON"

VERDICT="$(jq -r .verdict "$RESULT_JSON")"
SUMMARY="$(jq -r .summary "$RESULT_JSON")"
FINDINGS_JSON="$(jq -c .findings "$RESULT_JSON")"
USAGE_JSON="$(jq -c .usage "$RESULT_JSON")"

SUMMARY_FILE="${RUNNER_TEMP}/summary.md"
printf '%s\n' "$SUMMARY" > "$SUMMARY_FILE"

META_EXTRA="${RUNNER_TEMP}/comment-meta.json"
jq -n \
  --arg head_sha "$HEAD_SHA" \
  --arg base_sha "$BASE_SHA" \
  --arg trusted_base_sha "$TRUSTED_BASE_SHA" \
  --arg incremental_from "${INCREMENTAL_FROM:-}" \
  --argjson findings "$FINDINGS_JSON" \
  '{head_sha:$head_sha, base_sha:$base_sha, trusted_base_sha:$trusted_base_sha, incremental_from_sha:($incremental_from|select(length>0)), findings:$findings}' \
  > "$META_EXTRA"

BODY_FILE="${RUNNER_TEMP}/sticky-body.md"
node "${ACTION_ROOT}/scripts/claude-review/format-comment.mjs" "$VERDICT" "$SUMMARY_FILE" "$BODY_FILE" "$META_EXTRA"

T4="$(date +%s%3N)"
bash "${ACTION_ROOT}/scripts/claude-review/post-sticky-comment.sh" "$PR_NUMBER" "$BODY_FILE"
phase_ms "post_comment" "$T4"

REVIEW_ID="rk-${PR_NUMBER}-${HEAD_SHA:0:12}"
RECORD_PAYLOAD="${RUNNER_TEMP}/record-payload.json"
REPLY_BODIES="$(gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --paginate --jq '[.[] | select(.body|test("^/(fp|nit|wontfix)\\s")) | .body]')"
jq -n \
  --arg review_id "$REVIEW_ID" \
  --arg repository "$GITHUB_REPOSITORY" \
  --argjson pr_number "$PR_NUMBER" \
  --arg head_sha "$HEAD_SHA" \
  --arg base_sha "$BASE_SHA" \
  --arg incremental_from "${INCREMENTAL_FROM:-}" \
  --arg verdict "$VERDICT" \
  --arg model "${INPUT_CLAUDE_MODEL:-}" \
  --argjson findings "$FINDINGS_JSON" \
  --argjson usage "$USAGE_JSON" \
  --argjson phases "$(cat "$PHASES_FILE")" \
  --argjson reply_comment_bodies "$REPLY_BODIES" \
  '{
    review_id:$review_id, repository:$repository, pr_number:$pr_number,
    head_sha:$head_sha, base_sha:$base_sha, incremental_from_sha:($incremental_from|select(length>0)),
    verdict:$verdict, findings:$findings, model:$model,
    model_time_ms:$usage.model_time_ms, turns:$usage.turns, cost_usd:$usage.cost_usd,
    phases_ms:$phases, reply_comment_bodies:$reply_comment_bodies
  }' > "$RECORD_PAYLOAD"

RECORD_PATH="${RUNNER_TEMP}/review-record.json"
node "${ACTION_ROOT}/scripts/claude-review/write-record.mjs" "$RECORD_PATH" "$RECORD_PAYLOAD"

mkdir -p review-record
cp "$RECORD_PATH" "review-record/review-record.json"
echo "review_record_path=review-record/review-record.json" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "verdict=${VERDICT}" >> "${GITHUB_OUTPUT:-/dev/null}"

GATE_JSON="$(node "${ACTION_ROOT}/scripts/claude-review/parse-verdict.mjs" --body-file "$BODY_FILE" --record-file "$RECORD_PATH")"
GATE_FAILS="$(echo "$GATE_JSON" | jq -r .gate_fails)"

if [[ "$GATE_FAILS" == "true" ]]; then
  echo "::error::Review gate failed (verdict=${VERDICT} or open must-fix findings)."
  exit 1
fi

echo "Review gate passed."
