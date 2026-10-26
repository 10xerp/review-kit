# review-kit

A composite GitHub Action that runs the 10X Claude pull request review. Claude posts a review comment on the PR for each run (or rewrites one sticky comment with `sticky_comment: true`), and the check fails when the review is **Blocked** or when the review could not run on a PR that changes the review tooling.

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
      # Pin a commit, not a tag: this code runs with the OAuth token and a write-scoped
      # GITHUB_TOKEN on every PR. Bump the SHA on purpose, in a PR. The `# v2` comment
      # names the release tag the commit carries; tags only mark releases here.
      - uses: 10xerp/review-kit@b4cf21ec958bc976f2f78558d990e62c4d82f152 # v2
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # Docs-heavy repos (e.g. 10x-biz): review Markdown and docs/ changes.
          # review_docs: true
          # Rewrite one review comment instead of posting one per run.
          # sticky_comment: true
```

Keep the checkout's default credentials: claude-code-action fetches the PR branch with them before it switches to its own token.

To require the review before merging, make the `claude-review` job a required status check. When a PR changes the review workflow or its copy differs from the base branch, the model cannot run and the check **fails**; repository admins can still merge with a branch-ruleset bypass ("Merge without waiting for requirements"), which the PR timeline records. The action runs on Linux runners and needs `git`, `jq`, `curl` and Node.js 20 or later, all of which `ubuntu-latest` provides. The kit is meant for same-repository PRs: pull requests from forks don't receive secrets.

**Inputs**

| Input | Default | Description |
| --- | --- | --- |
| `claude_code_oauth_token` | required | Claude Code OAuth token. |
| `review_docs` | `false` | When `true`, review PRs that only change Markdown or files under `docs/` (for example PII checks in a docs repo, or a repo whose review standards and agent skills live in Markdown). Image-only PRs still skip. Default `false` skips docs and images. |
| `sticky_comment` | `false` | When `false`, each run posts a new comment, so the PR shows every review in order; the newest is the verdict, open Must Fix findings carry forward from it, and a cancelled run deletes its own placeholder. When `true`, each run rewrites the PR's one review comment, so the PR shows only the latest verdict and earlier ones live in the comment's edit history. |

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

The heading is one of `# Review: Approved`, `# Review: Approve with notes` or `# Review: Blocked`. Finding lines are `- path:line [category]: text`; the kit stamps a stable ID (`[F1]`, `[F2]`, …) on each one. IDs never repeat on a PR: the highest one used so far is kept in the metadata (`max_id`), so a review with no findings does not restart the numbering. `Fixed: F#` closes an earlier finding that was fixed; `Dismissed: F#` closes one after a `/fp` or `/wontfix` reply. When the kit finalizes the comment, it appends hidden metadata that tools such as hub's `pr` skill read:

```
<!-- claude-review:v1
last_sha=<reviewed head commit>
run_id=<workflow run id>
verdict=blocked
max_id=7
-->
```

## Behaviour

**Verdict gate.** The verdict is read once from the `# Review:` line. If anything is listed under `## Issues (Must Fix)`, the verdict is Blocked regardless of the heading, and the heading is rewritten to `# Review: Blocked`. The heading, the hidden metadata, the record and the check result therefore always agree. Blocked fails the check. A review without a parseable `# Review:` line also fails the check.

**Open Must Fix findings stay open.** A Must Fix from the previous review closes only through a `Fixed: F#` or `Dismissed: F#` line in the new review. One the new review neither closes nor re-lists is carried forward under `## Issues (Must Fix)` with the note "still open from an earlier review", and the PR stays Blocked. A push that does not touch the finding therefore cannot clear it, whatever the model writes. Suggestions are not carried: the standards ask the model not to repeat them.

**Scope.** These PRs are not reviewed, and the check passes:
- draft PRs (marking the PR ready for review starts a review);
- PRs that only change Markdown, `docs/`, or PNG, JPG and GIF images (unless `review_docs: true`; then Markdown and `docs/` are reviewed and only image-only PRs skip).

These PRs are not reviewed either, because claude-code-action refuses to start, and the check **fails**:
- PRs that change the workflow file that runs the review;
- PRs whose copy of that workflow differs from the base branch (merge the base branch to fix that).

**Review modes.**
- *Full:* on `opened`, `reopened` and `ready_for_review`, on the first review of a PR, and when the last reviewed commit is no longer in the history (after a force push). Claude starts from `git diff origin/<base>...HEAD`. When there are still-open Must Fix findings from an earlier review, they are included in the prompt (without the incremental "since …" sentence).
- *Incremental:* on later pushes. Claude starts from `git diff <last reviewed>..HEAD`, limited to the files whose PR changes moved since then. It gets the open Must Fix findings and any replies to them, and acknowledges resolved ones with `Fixed: F#`.
- *Carry-forward:* when a push doesn't change what the PR itself changes (for example, a merge from the base branch, or a re-run on a commit that was already reviewed), the model is skipped. The previous review is stamped with the new commit, and its verdict is applied again, so a Blocked PR stays Blocked.

**Replies.** Comment `/fp F2 reason`, `/nit F3` or `/wontfix F1 reason` on the PR. Replies are passed to Claude with the open findings on the next review and kept in the record. They don't change the current check: the next review closes the finding with `Dismissed: F#` if Claude agrees, or carries it forward if not.

**Record.** Each run uploads a `claude-review-record-<pr>-<run id>-<attempt>` artifact when a record is written, kept for 90 days (including tooling-blocked runs). It is `review-record.json` (schema 2) and contains the verdict, mode, findings with IDs and status (`open`, `carried`, `fixed` or `dismissed`), fixed, dismissed and carried IDs, replies, model, Claude Code version, action and standards SHAs, skip reason when the model did not run, and metrics. The metrics are model time (`duration_ms`), turns, cost, queue time, wall time, and phase timestamps and durations (`prep_s`, `install_s`, `model_s`, `finalize_s`, `direct_install_s`).

**Claude Code.** The review runs [claude-code-action](https://github.com/anthropics/claude-code-action) at a pinned commit, with model `claude-opus-5-5` and at most 60 turns. Typical reviews take 4 to 12. The cap only stops a runaway review, and 22 was low enough to stop reviews of 60-file PRs before they posted a verdict. It is fixed in the kit rather than an input, so a PR cannot lower it. The kit downloads the Claude Code release that this commit pins and checks it against the release manifest's sha256. If the download fails, the action installs Claude Code itself.

**Security.** The kit is built for same-repository PRs from people and bots you already trust with the repo. Its job is to stop the PR from steering its own review, not to contain a hostile author: anyone who can open a PR in the repo can already read its secrets by editing a workflow.
- The review standards come from the PR's base branch. `.claude/`, `CLAUDE.md`, `CLAUDE.local.md`, every nested `CLAUDE.md`, and nested `.claude/` directories are replaced by their base-branch versions (or removed) before Claude starts, so a PR cannot add instructions Claude would load.
- Claude runs with `--strict-mcp-config`, so the repo's `.mcp.json` is ignored, and with `--restricted`, so repo settings files and their hooks are ignored.
- The only tools are Read, Grep, Glob and Bash restricted to `git diff`, `git log`, `git show` and `git rev-parse`. `git add`, `git commit` and `git rm` are denied, and Read, Grep and Glob are denied under `.git/**` (where the action keeps its token) and `/proc/**` (where process environments are readable).
- Those denies narrow Claude's reach but are not a secrets boundary: a git command with the right flags can still print a file on the runner, and the tokens in the job's environment are inherited by Claude's shell. What limits the damage is that Claude's only output is the PR comment, and that the tokens expire with the job. Do not run the kit on PRs from people you would not give the repo's secrets to.
- Only review comments written by `claude[bot]` are trusted, and a finding closes only through an explicit `Fixed:` or `Dismissed:` line in such a comment.

**Cancellation.** If a run is cancelled (for example by a newer push) while the comment still shows Claude's progress placeholder, the previous review is restored.

## Release bumps

Tag a release with an annotated tag (`v1`, `v2`, …). Pushing a tag matching `v*` runs the **Bump review-kit consumers** workflow, which opens (or updates) a pull request in each repo listed in [`release/consumers.txt`](release/consumers.txt). Consumers must keep pinning this action by full 40-character commit SHA with a `# vN` comment, never a branch or tag ref. The workflow never merges; a human merges each bump PR.

Bump PRs change `.github/workflows`, so the `claude-review` check fails by design. Merge them with a repository admin bypass (same as any PR that updates the review workflow).

Re-run a bump manually with **Actions → Bump review-kit consumers → Run workflow** and the tag name (for example `v4`).

### One-time setup (Brian)

The default `GITHUB_TOKEN` in this repository cannot write to other repos, and one fine-grained PAT cannot cover both the **10xerp** organization and the **bd28** personal account. Use one **GitHub App** and mint an installation token per owner with `actions/create-github-app-token`:

1. Create a GitHub App (for example under **10xerp**).
2. **Permissions** (repository): **Contents** read & write, **Pull requests** read & write, **Workflows** read & write (workflow files live under `.github/workflows`).
3. Install the app on **all** consumer repositories under **10xerp** and **bd28** (see `release/consumers.txt`). Both installations use the same App ID and private key.
4. Add these **repository secrets** on **10xerp/review-kit**:
   - `REVIEW_KIT_BUMP_GITHUB_APP_ID` — the app’s numeric ID
   - `REVIEW_KIT_BUMP_GITHUB_APP_PRIVATE_KEY` — the app’s PEM private key (`-----BEGIN RSA PRIVATE KEY-----` …)

If the secrets are missing or an owner has no installation, repos under that owner are reported as failed in the workflow summary with a clear message; other repos still run.

## Development

```bash
node --test
shellcheck -x scripts/claude-review/*.sh
```

The review job uses only bash, `jq`, `curl` and plain Node.js ESM, with no package install. Here is what each part does:

- `prep.sh` decides scope and mode, then writes the prompt.
- `install.sh` downloads Claude Code.
- `finalize.sh` stamps the comment, writes the record and applies the gate.
- `cancel-cleanup.sh` restores the previous comment after a cancellation, or, with per-run comments (the default), deletes the run's placeholder.
- `cli.mjs` connects the scripts to the Node modules.
