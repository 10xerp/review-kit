#!/usr/bin/env bash
# Downloads the Claude Code release that claude-code-action pins and checks its sha256. When that
# fails, claude_code_path stays empty and the action installs Claude Code itself.
set -euo pipefail
# shellcheck source-path=SCRIPTDIR source=lib.sh
source "$(dirname "$0")/lib.sh"

OUT_DIR="$WORK/claude-code-bin"
start_s=$(date +%s)
path=$(node "$KIT/install-claude-code.mjs" --out-dir "$OUT_DIR" --action-ref "${CLAUDE_CODE_ACTION_SHA:?}" 2> /dev/null || true)
end_s=$(date +%s)
phase direct_install_s "$((end_s - start_s))"
phase install_done

if [[ -n "$path" && -x "$path" ]]; then
  version=$(jq -r '.version // empty' "$OUT_DIR/install-meta.json")
  output claude_code_path "$path"
  step_summary "Direct Claude Code install: ${version} (${path}) in $((end_s - start_s))s."
else
  output claude_code_path ""
  echo "::notice::Using Claude Code action default installer (direct download unavailable)."
fi
