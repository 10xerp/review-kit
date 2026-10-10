# review-kit

Shared **composite GitHub Action** for Claude Code PR reviews across 10X repos. Consumers keep a short workflow plus repo-specific review standards on the trusted default branch.

## Consumer setup

1. Add repository secret **`ANTHROPIC_API_KEY`** (Anthropic API key for Claude Code).
2. Add **`.claude/skills/review-standards/SKILL.md`** on your default branch (merge rules, severity definitions, stack-specific checks).
3. Add a workflow like the one below.

### Workflow (copy/paste)

```yaml
name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review, reopened]

concurrency:
  group: claude-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  claude-review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha }}

      - name: Claude PR review
        uses: 10xerp/review-kit@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ github.token }}
          # Optional: override default branch used for SKILL.md (never the PR head)
          # trusted_base_branch: main
```

Until `v1` is tagged, point `uses` at a commit SHA or `@main` from this repo.

## What the action does

- Runs **review-kit** scripts from the action ref (bash + `jq` + Node ESM helpers only in the review job — no pnpm/tsx).
- Loads **`.claude/skills/review-standards/SKILL.md`** from the consumer repo’s **trusted base branch**, not the PR head.
- Installs a **pinned Claude Code** release, or uses **`path_to_claude_code_executable`** when provided (with install fallback).
- Invokes Claude with **`--strict-mcp-config`** only (no extra MCP wiring in the action).
- Posts one **sticky** PR comment (updated in place) whose visible heading and hidden `review-kit-meta` block share the **same parsed verdict**.
- Supports **incremental** re-reviews from the last reviewed `head_sha` in comment meta.
- Skips **draft** PRs, non-open PRs, and duplicate in-flight runs on the same SHA (**narrowed** skip rules).
- Writes a **`review-record`** artifact (finding IDs, usage, `/fp` `/nit` `/wontfix` replies, phase timings).
- **Fails the job** when the canonical verdict is `blocked` or any **must_fix** finding remains open (after reply dismissal).

## Verdict gate (single source of truth)

The check reads **`<!-- review-kit-meta { "verdict": ... } -->`** only. The markdown heading (`# Review: …`) is derived from that verdict when posting, so a comment cannot show `Review: Blocked` while the gate passes on `approve_with_notes`.

## Development

```bash
npm test
```

## License

Internal 10X ERP use.
