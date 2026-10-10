#!/usr/bin/env bash
# Parse sticky comment + record; exit 1 when the review gate fails.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BODY_FILE="${1:?body file}"
RECORD_FILE="${2:-}"
ARGS=(--body-file "$BODY_FILE")
[[ -n "$RECORD_FILE" ]] && ARGS+=(--record-file "$RECORD_FILE")
GATE_JSON="$(node "${ROOT}/scripts/claude-review/parse-verdict.mjs" "${ARGS[@]}")"
echo "$GATE_JSON"
[[ "$(echo "$GATE_JSON" | jq -r .gate_fails)" == "true" ]] && exit 1
exit 0
