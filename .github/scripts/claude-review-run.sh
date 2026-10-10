#!/usr/bin/env bash
# Hub-compatible entrypoint name — delegates to review-kit orchestrator.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REVIEW_KIT_ACTION_PATH="${REVIEW_KIT_ACTION_PATH:-$ROOT}"
exec bash "${REVIEW_KIT_ACTION_PATH}/scripts/claude-review/run-review.sh"
