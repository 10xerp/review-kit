#!/usr/bin/env bash
# Shared helpers for the review scripts (sourced, not executed).
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${RUNNER_TEMP:?}/claude-review"
STATE="$WORK/state.json"
PHASES="$WORK/phases.json"

cli() { node "$KIT/cli.mjs" "$@"; }
fail() {
  echo "::error::$*" >&2
  exit 1
}
output() { echo "$1=$2" >> "${GITHUB_OUTPUT:?}"; }
step_summary() { echo "$*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
state() { jq -r ".$1" "$STATE"; }

# phase NAME [VALUE]: records VALUE (default: now, in epoch seconds) in the review record's phases.
phase() {
  jq --arg k "$1" --argjson v "${2:-$(date +%s)}" '. + {($k): $v}' "$PHASES" > "$PHASES.tmp"
  mv "$PHASES.tmp" "$PHASES"
}

fetch_comments() {
  gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$1/comments?per_page=100" | jq -s 'add // []'
}
