# review-kit

A composite GitHub Action that reviews pull requests with Claude Code. It posts one sticky review comment and fails the check when the review is **Blocked**.

A consumer repo needs two things: the workflow below and its own review standards.

## Setup

1. Add the repository secret `ANTHROPIC_API_KEY`.
2. Commit your review standards to `.claude/skills/review-standards/SKILL.md` on the default branch. They are always read from that branch, never from the PR.
3. Add `.github/workflows/claude-review.yml`:

```yaml
name: Claude Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

concurrency:
  group: claude-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: 10xerp/review-kit@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

To require the review before merging, make the `review` job a required status check.

The action runs on Linux runners and needs `git`, `jq`, `curl` and Node.js 20 or later, all of which `ubuntu-latest` provides. The kit is meant for same-repository PRs: pull requests from forks don't receive secrets, so the review job fails on them.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `anthropic_api_key` | required | Anthropic API key for Claude Code. |
| `trusted_base_branch` | repository default branch | Branch that the review standards and Claude config are read from. |
| `model` | Claude Code default | Passed to `--model`. |
| `max_turns` | `40` | Maximum agent turns for one review. |
| `claude_code_version` | `2.1.287` | Claude Code release to install. |
| `path_to_claude_code_executable` | empty | Use this executable instead of installing Claude Code. |

Outputs: `verdict` (`approve`, `approve_with_notes`, `blocked` or `skipped`) and `record_path`.

## Behaviour

**Verdict gate.** Claude ends its answer with a JSON block containing `verdict`, `summary` and `findings`. The block is parsed exactly once. The verdict is `blocked` if Claude says so or if any finding is `must_fix`. The comment heading (`Review: Approved`, `Review: Approved with notes` or `Review: Blocked`), the hidden metadata, the record and the check result all come from that one value. A Blocked review fails the check. If the output can't be parsed, the check fails and no comment is posted.

**Sticky comment.** Each PR has one review comment, which is updated in place. The comment carries hidden metadata: the verdict, the reviewed commit and the findings. Only metadata in comments written by `github-actions[bot]` is trusted.

**Incremental re-reviews.** When new commits build on the last reviewed commit, Claude only reviews what changed since then in the PR's files. It also gets the previous findings and the replies to them. A finding that still applies keeps its ID (`F1`, `F2`, …), and new findings get new IDs.

**Replies.** Comment `/fp F3 reason`, `/nit F3` or `/wontfix F3 reason` on the PR to answer a finding. Replies are passed to Claude on the next review and kept in the record. They don't change the current check by themselves; push a fix or a new commit to get a new review.

**Skip rules.**
- Draft PRs are skipped, and the check passes. Marking the PR ready for review triggers a review.
- If the head commit was already reviewed, or the new commits don't change any of the PR's files (for example, a merge from the base branch that touches other files), the previous verdict is reused without calling Claude. A Blocked PR stays Blocked.
- Re-running the job by hand forces a full review.

**Record.** Each run uploads a `claude-review-record-attempt-N` artifact containing the verdict, mode, finding IDs, `/fp` `/nit` `/wontfix` replies, model time, turns, cost and per-phase timings. The same summary is shown on the job page.

**Security.**
- The review standards, `.claude/` and `CLAUDE.md` come from the trusted branch. PR versions of them are removed before Claude starts.
- Claude Code runs with `--restricted` (ignores user and project settings, so PR hooks never run), `--strict-mcp-config` (no MCP servers) and only the `Read`, `Grep` and `Glob` tools.
- Claude never sees the GitHub token.
- A comment that contains the API key is never posted.

## Development

```bash
node --test
shellcheck scripts/claude-review/*.sh
```

The review job uses only bash, `jq`, `curl` and plain Node.js ESM, with no package install. Pure logic lives in `scripts/claude-review/lib.mjs`, `cli.mjs` exposes it to `review.sh`, and `review.sh` runs the review end to end.
