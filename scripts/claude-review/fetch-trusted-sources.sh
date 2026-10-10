#!/usr/bin/env bash
# Load consumer-repo review standards (and optional trusted scripts) from base branch, never PR head.
set -euo pipefail

TRUSTED_BRANCH="${INPUT_TRUSTED_BASE_BRANCH:-}"
if [[ -z "$TRUSTED_BRANCH" ]]; then
  TRUSTED_BRANCH="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"
fi

echo "Trusted base branch: ${TRUSTED_BRANCH}"
git fetch origin "${TRUSTED_BRANCH}:refs/remotes/review-kit/trusted-base" --depth=1

TRUSTED_DIR="${RUNNER_TEMP:-/tmp}/review-kit-trusted"
rm -rf "$TRUSTED_DIR"
mkdir -p "$TRUSTED_DIR"

git archive "refs/remotes/review-kit/trusted-base" \
  .claude/skills/review-standards \
  2>/dev/null | tar -x -C "$TRUSTED_DIR" || true

STANDARDS="${TRUSTED_DIR}/.claude/skills/review-standards/SKILL.md"
if [[ ! -f "$STANDARDS" ]]; then
  echo "::error::Missing .claude/skills/review-standards/SKILL.md on trusted base branch ${TRUSTED_BRANCH}"
  exit 1
fi

printf 'review_standards_path=%q\n' "$STANDARDS"
printf 'trusted_base_sha=%q\n' "$(git rev-parse refs/remotes/review-kit/trusted-base)"
