#!/usr/bin/env bash
set -euo pipefail

emit() {
  echo "$1"
  echo "$1" >> "${GITHUB_OUTPUT:-/dev/null}" 2>/dev/null || true
}

PR_NUMBER="${GITHUB_EVENT_PULL_REQUEST_NUMBER:-${PR_NUMBER:-}}"
if [[ -z "$PR_NUMBER" && -n "${GITHUB_EVENT_PATH:-}" && -f "$GITHUB_EVENT_PATH" ]]; then
  PR_NUMBER="$(jq -r '.pull_request.number // .issue.number // empty' "$GITHUB_EVENT_PATH")"
fi

if [[ -z "$PR_NUMBER" ]]; then
  emit "skip=false"
  emit "skip_reason="
  exit 0
fi

IS_DRAFT="$(gh pr view "$PR_NUMBER" --json isDraft -q .isDraft)"
if [[ "$IS_DRAFT" == "true" ]]; then
  echo "::notice::Skipping review — PR #${PR_NUMBER} is draft" >&2
  emit "skip=true"
  emit "skip_reason=draft"
  exit 0
fi

if [[ "$(gh pr view "$PR_NUMBER" --json state -q .state)" != "OPEN" ]]; then
  echo "::notice::Skipping review — PR #${PR_NUMBER} is not open" >&2
  emit "skip=true"
  emit "skip_reason=not_open"
  exit 0
fi

SHA="${GITHUB_SHA:-}"
if [[ -n "$SHA" && -n "${GITHUB_RUN_ID:-}" ]]; then
  PEER="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs?head_sha=${SHA}&per_page=20" \
    --jq "[.workflow_runs[] | select(.name == \"${GITHUB_WORKFLOW:-Claude Code Review}\" and (.id|tostring) != \"${GITHUB_RUN_ID}\" and .status != \"completed\")] | length" 2>/dev/null || echo 0)"
  if [[ "${PEER:-0}" -gt 0 ]]; then
    echo "::notice::Skipping review — another run is in progress for ${SHA}" >&2
    emit "skip=true"
    emit "skip_reason=duplicate_sha_run"
    exit 0
  fi
fi

emit "skip=false"
emit "skip_reason="
