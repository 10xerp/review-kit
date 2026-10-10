#!/usr/bin/env bash
# Prints the path of the Claude Code executable to use. Logs go to stderr.
set -euo pipefail

VERSION="${INPUT_CLAUDE_CODE_VERSION:?claude_code_version is required}"
CUSTOM="${INPUT_PATH_TO_CLAUDE_CODE_EXECUTABLE:-}"

if [[ -n "$CUSTOM" ]]; then
  if [[ ! -x "$CUSTOM" ]]; then
    echo "::error::path_to_claude_code_executable is not an executable file: $CUSTOM" >&2
    exit 1
  fi
  echo "Using provided Claude Code executable: $CUSTOM" >&2
  echo "$CUSTOM"
  exit 0
fi

BIN="$HOME/.local/bin/claude"
if ! { curl -fsSL --retry 3 https://claude.ai/install.sh | bash -s -- "$VERSION" >&2 && [[ -x "$BIN" ]]; }; then
  echo "::warning::Direct install of Claude Code $VERSION failed; falling back to npm" >&2
  PREFIX="${RUNNER_TEMP:?}/claude-code-npm"
  npm install --silent --no-fund --no-audit --prefix "$PREFIX" "@anthropic-ai/claude-code@$VERSION" >&2
  BIN="$PREFIX/node_modules/.bin/claude"
fi

INSTALLED="$("$BIN" --version | awk '{print $1}')"
if [[ "$INSTALLED" != "$VERSION" ]]; then
  echo "::error::Expected Claude Code $VERSION but $BIN reports $INSTALLED" >&2
  exit 1
fi
echo "Installed Claude Code $INSTALLED at $BIN" >&2
echo "$BIN"
