# review-kit

A composite GitHub Action that runs the 10X Claude pull request review (hub's review v14). Claude posts one sticky review comment on the PR, and the check fails when the review is **Blocked**.

## Setup

1. Install the [Claude GitHub App](https://github.com/apps/claude) on the repository. The review comment is posted as `claude[bot]`.
2. Add the repository secret `CLAUDE_CODE_OAUTH_TOKEN` (create one with `claude setup-token`).
3. Commit your review standards to `.claude/skills/review-standards/SKILL.md` on the base branch; see [Review output](#review-output) for the format they must ask for. They are always read from the PR's base branch, never from the PR.
4. Add `.github/workflows/claude-code-review.yml`:

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
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
      actions: read
      id-token: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: 10xerp/review-kit@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # Docs-heavy repos (e.g. 10x-biz): review Markdown and docs/ changes.
          # review_docs: true
```

Keep the checkout's default credentials: claude-code-action fetches the PR branch with them before it switches to its own token.

To require the review before merging, make the `claude-review` job a required status check. The action runs on Linux runners and needs `git`, `jq`, `curl` and Node.js 20 or later, all of which `ubuntu-latest` provides. The kit is meant for same-repository PRs: pull requests from forks don't receive secrets.

**Inputs**

| Input | Default | Description |
| --- | --- | --- |
| `claude_code_oauth_token` | required | Claude Code OAuth token. |
| `review_docs` | `false` | When `true`, review PRs that only change Markdown or files under `docs/` (for example PII checks in a docs repo). Image-only PRs still skip. Default `false` matches hub and billing (skip docs and images). |

**Outputs:** `verdict` (`approved`, `approve_with_notes`, `blocked` or `skipped`) and `record_path`.

## Review output

Claude writes the review in the format the standards define, and the kit parses it. The first `# Review:` line is the verdict:

```
# Review: Blocked

Fixed: F1

## Issues (Must Fix)
- [F2] app/api/x/route.ts:4 [security]: missing auth check; call requireApiAccess()

## Suggestions (Should Fix)
- [F3] lib/services/y.ts:20 [maintainability]: duplicated query; reuse getY()
```

The heading is one of `# Review: Approved`, `# Review: Approve with notes` or `# Review: Blocked`. Finding lines are `- path:line [category]: text`; the kit stamps a stable ID (`[F1]`, `[F2]`, …) on each one. `Fixed: F#` lines mark earlier findings as resolved. When the kit finalizes the comment, it appends hidden metadata that tools such as hub's `pr` skill read:

```
<!-- claude-review:v1
last_sha=<reviewed head commit>
run_id=<workflow run id>
verdict=blocked
-->
```

## Behaviour

**Verdict gate.** The verdict is read once from the `# Review:` line. If anything is listed under `## Issues (Must Fix)`, the verdict is Blocked regardless of the heading, and the heading is rewritten to `# Review: Blocked`. The heading, the hidden metadata, the record and the check result therefore always agree. Blocked fails the check. A review without a parseable `# Review:` line also fails the check.

**Scope.** These PRs are not reviewed, and the check passes:
- draft PRs (marking the PR ready for review starts a review);
- PRs that only change Markdown, `docs/`, or PNG, JPG and GIF images (unless `review_docs: true`; then Markdown and `docs/` are reviewed and only image-only PRs skip);
- PRs that change the workflow file that runs the review.

**Review modes.**
- *Full:* on `opened`, `reopened` and `ready_for_review`, on the first review of a PR, and when the last reviewed commit is no longer in the history (after a force push). Claude starts from `git diff origin/<base>...HEAD`.
- *Incremental:* on later pushes. Claude starts from `git diff <last reviewed>..HEAD`, limited to the files whose PR changes moved since then. It gets the open Must Fix findings and any replies to them, and acknowledges resolved ones with `Fixed: F#`.
- *Carry-forward:* when a push doesn't change what the PR itself changes (for example, a merge from the base branch, or a re-run on a commit that was already reviewed), the model is skipped. The previous review is stamped with the new commit, and its verdict is applied again, so a Blocked PR stays Blocked.

**Replies.** Comment `/fp F2 reason`, `/nit F3` or `/wontfix F1 reason` on the PR. Replies are passed to Claude with the open findings on the next review and kept in the record. They don't change the current check.

**Record.** Each review uploads a `claude-review-record-<pr>-<run id>-<attempt>` artifact, kept for 90 days. It is `review-record.json` (schema 1) and contains the verdict, mode, findings with IDs and open or fixed status, fixed IDs, replies, model, Claude Code version, action and standards SHAs, and metrics. The metrics are model time (`duration_ms`), turns, cost, queue time, wall time, and phase timestamps and durations (`prep_s`, `install_s`, `model_s`, `finalize_s`, `direct_install_s`).

**Claude Code.** The review runs [claude-code-action](https://github.com/anthropics/claude-code-action) at a pinned commit, with `claude-opus-5-5` and at most 22 turns. The kit downloads the Claude Code release that this commit pins and checks it against the release manifest's sha256. If the download fails, the action installs Claude Code itself.

**Security.**
- The review standards come from the PR's base branch. `.claude/` and `CLAUDE.md` are also replaced by their base-branch versions before Claude starts.
- Claude runs with `--strict-mcp-config`, so the repo's `.mcp.json` is ignored.
- Claude also runs with `--restricted`, so repo settings files and their hooks are ignored.
- Read, Grep and Glob are denied for `.git/**` paths (so Claude cannot read `.git/config`, where the action stores its token). `git diff` and the other allowed Bash git commands still work.
- The only tools are Read, Grep, Glob and Bash restricted to `git diff`, `git log`, `git show` and `git rev-parse`. `git add`, `git commit` and `git rm` are denied.
- Only review comments written by `claude[bot]` are trusted.

**Cancellation.** If a run is cancelled (for example by a newer push) while the comment still shows Claude's progress placeholder, the previous review is restored.

## Development

```bash
node --test
shellcheck -x scripts/claude-review/*.sh
```

The review job uses only bash, `jq`, `curl` and plain Node.js ESM, with no package install. Here is what each part does:

- `prep.sh` decides scope and mode, then writes the prompt.
- `install.sh` downloads Claude Code.
- `finalize.sh` stamps the comment, writes the record and applies the gate.
- `cancel-cleanup.sh` restores the previous comment after a cancellation.
- `cli.mjs` connects the scripts to the Node modules.
