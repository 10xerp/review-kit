import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrompt, openFindingsWithReplies } from "../scripts/claude-review/prompt.mjs";

const base = {
  repo: "10xerp/hub",
  pr: "7",
  headSha: "headsha",
  baseRef: "main",
  standards: "# Code review standards\n\nBlock test.\n",
};

describe("buildPrompt", () => {
  it("matches hub v14's prompt for a full review", () => {
    const prompt = buildPrompt({ ...base, mode: "full", diffInstruction: "git diff origin/main...HEAD", lastSha: "" });
    assert.equal(
      prompt,
      `REPO: 10xerp/hub
PR NUMBER: 7
HEAD SHA: headsha
REVIEW MODE: full

Review this PR using the review-standards skill below. Apply its criteria and output format exactly.
Skip the self-review loop. Do not run pnpm, npm, vitest, installs, builds, or CI commands; CI already does that.

Start from \`git diff origin/main...HEAD\` (PR base \`main\`). Read every file touched in that diff in full (not only hunks). Use Grep for callers of changed public APIs.



Post the review as the sticky PR comment (update in place). First line must be exactly one of:
\`# Review: Approved\`, \`# Review: Approve with notes\`, or \`# Review: Blocked\`.

<review_standards>
# Code review standards

Block test.
</review_standards>
`,
    );
  });

  it("includes prior open findings in full review mode without the incremental sentence", () => {
    const prompt = buildPrompt({
      ...base,
      mode: "full",
      diffInstruction: "git diff origin/main...HEAD",
      lastSha: "oldsha",
      openFindings: "- [F1] src/a.ts:1 [security]: leak",
    });
    assert.doesNotMatch(prompt, /incremental re-review since/);
    assert.ok(
      prompt.includes(
        "Every prior open Must Fix below stays open, and keeps the PR Blocked, until you close it: " +
          "write `Fixed: F#` after checking the fix landed, or `Dismissed: F#` when a /fp or /wontfix reply convinces you. " +
          "Re-list a still-open one under Issues only to update its wording; leaving it out does not close it. " +
          "Do not repeat Suggestions from the prior review. Prior open findings:\n- [F1] src/a.ts:1 [security]: leak\n",
      ),
    );
  });

  it("adds hub's incremental block with the prior open findings", () => {
    const prompt = buildPrompt({
      ...base,
      mode: "incremental",
      diffInstruction: "git diff last..HEAD -- src/a.ts",
      lastSha: "lastsha",
      openFindings: "- [F1] src/a.ts:1 [security]: leak",
    });
    assert.ok(
      prompt.includes(
        "This is an incremental re-review since lastsha. Every prior open Must Fix below stays open, and keeps the PR Blocked, until you close it: " +
          "write `Fixed: F#` after checking the fix landed, or `Dismissed: F#` when a /fp or /wontfix reply convinces you. " +
          "Re-list a still-open one under Issues only to update its wording; leaving it out does not close it. " +
          "Do not repeat Suggestions from the prior review. Prior open findings:\n- [F1] src/a.ts:1 [security]: leak\n",
      ),
    );
    assert.ok(prompt.includes("Start from `git diff last..HEAD -- src/a.ts` (PR base `main`)."));
  });
});

describe("openFindingsWithReplies", () => {
  it("lists open Must Fix findings with the replies to each", () => {
    const prior = `# Review: Blocked

## Issues (Must Fix)
- [F1] a.ts:1 [security]: leak
- [F2] b.ts:2 [correctness]: off by one

## Suggestions (Should Fix)
- [F3] c.ts:3 [convention]: naming
`;
    const replies = [
      { finding_id: "F1", reply: "fp", reason: "guarded upstream", author: "alice" },
      { finding_id: "F3", reply: "nit", reason: "", author: "bob" },
      { finding_id: "F1", reply: "wontfix", reason: "", author: "carol" },
    ];
    assert.equal(
      openFindingsWithReplies(prior, replies),
      [
        "- [F1] a.ts:1 [security]: leak",
        "  - @alice replied /fp: guarded upstream",
        "  - @carol replied /wontfix",
        "- [F2] b.ts:2 [correctness]: off by one",
      ].join("\n"),
    );
  });
});
