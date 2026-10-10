#!/usr/bin/env bash
# Pin Claude Code install with optional custom executable (hub-compatible).
set -euo pipefail

CLAUDE_CODE_VERSION="${INPUT_CLAUDE_CODE_VERSION:-2.1.42}"
CUSTOM="${INPUT_PATH_TO_CLAUDE_CODE_EXECUTABLE:-}"

resolve_claude() {
  if [[ -n "$CUSTOM" && -x "$CUSTOM" ]]; then
    echo "$CUSTOM"
    return 0
  fi
  if [[ -n "$CUSTOM" && ! -x "$CUSTOM" ]]; then
    echo "::warning::path_to_claude_code_executable is set but not executable: $CUSTOM — falling back to install" >&2
  fi
  if command -v claude >/dev/null 2>&1; then
    command -v claude
    return 0
  fi
  local home_bin="${HOME}/.local/bin/claude"
  if [[ -x "$home_bin" ]]; then
    echo "$home_bin"
    return 0
  fi
  return 1
}

if resolved="$(resolve_claude)"; then
  echo "Using Claude Code executable: $resolved"
  printf 'claude_executable=%q\n' "$resolved"
  dirname "$resolved" >> "${GITHUB_PATH:-/dev/null}" 2>/dev/null || true
  export PATH="$(dirname "$resolved"):$PATH"
  exit 0
fi

echo "Installing Claude Code v${CLAUDE_CODE_VERSION}..."
for attempt in 1 2 3; do
  echo "Installation attempt ${attempt}..."
  if curl -fsSL https://claude.ai/install.sh | bash -s -- "$CLAUDE_CODE_VERSION"; then
    break
  fi
  if [[ "$attempt" -eq 3 ]]; then
    echo "::error::Failed to install Claude Code after 3 attempts"
    exit 1
  fi
  sleep 5
done

home_bin="${HOME}/.local/bin/claude"
if [[ ! -x "$home_bin" ]]; then
  echo "::error::Claude Code install did not produce ${home_bin}"
  exit 1
fi

echo "${HOME}/.local/bin" >> "${GITHUB_PATH:-/dev/null}" 2>/dev/null || true
export PATH="${HOME}/.local/bin:$PATH"
printf 'claude_executable=%q\n' "$home_bin"
echo "Installed Claude Code: $home_bin" >&2
