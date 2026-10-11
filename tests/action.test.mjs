import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const action = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
const claudeArgs = action.match(/claude_args: \|\n((?: {10}.*\n)+)/)[1].split("\n").map((l) => l.trim()).filter(Boolean);

describe("action.yml", () => {
  it("installs the Claude Code version pinned by the claude-code-action commit it runs", () => {
    const uses = action.match(/uses: anthropics\/claude-code-action@([0-9a-f]{40})/)[1];
    const pinned = [...action.matchAll(/CLAUDE_CODE_ACTION_SHA: ([0-9a-f]{40})/g)].map((m) => m[1]);
    assert.equal(pinned.length, 2);
    for (const sha of pinned) assert.equal(sha, uses);
  });

  it("records the model it passes to Claude, both from the model input", () => {
    const model = claudeArgs.find((a) => a.startsWith("--model ")).slice("--model ".length);
    assert.equal(model, "${{ inputs.model }}");
    assert.equal(action.match(/REVIEW_MODEL: (.+)/)[1], model);
    assert.match(action, /^\s+model:\n(?:.*\n){1,3}\s+default: claude-opus-5-5$/m);
    assert.match(action, /^\s+max_turns:\n(?:.*\n){1,3}\s+default: "22"$/m);
  });

  it("passes hub v14's claude_args plus the restricted-mode lockdown", () => {
    assert.deepEqual(claudeArgs, [
      "--strict-mcp-config",
      "--restricted",
      '--tools "Bash,Glob,Grep,Read"',
      '--disallowedTools "Bash(git add:*),Bash(git commit:*),Bash(git rm:*),Bash(git diff --no-index:*)"',
      "--model ${{ inputs.model }}",
      "--max-turns ${{ inputs.max_turns }}",
      '--allowedTools "Glob,Grep,LS,Read,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git rev-parse:*)"',
    ]);
    assert.match(claudeArgs.join(" "), /Bash\(git diff:\*\)/);
  });

  it("denies Read, Grep and Glob under .git and /proc, and git diff --no-index, via Claude settings", () => {
    const settings = JSON.parse(action.match(/settings: \|\n((?: {10}.*\n)+)/)[1].replace(/^ {10}/gm, ""));
    assert.deepEqual(settings.permissions.deny, [
      "Read(.git/**)",
      "Read(**/.git/**)",
      "Grep(.git/**)",
      "Glob(.git/**)",
      "Read(//proc/**)",
      "Grep(//proc/**)",
      "Glob(//proc/**)",
      "Bash(git diff --no-index:*)",
    ]);
  });

  it("fails on review tooling changes by default and exposes tooling_change", () => {
    assert.match(action, /^\s+tooling_change:\n(?:.*\n){1,6}\s+default: "fail"$/m);
    assert.match(action, /INPUT_TOOLING_CHANGE: \$\{\{ inputs\.tooling_change \}\}/);
  });

  it("skips install and Claude when workflow validation would fail", () => {
    assert.match(action, /skip_workflow_validation != 'true'/);
  });

  it("exposes review_docs for docs-heavy repos", () => {
    assert.match(action, /^\s+review_docs:\n/m);
    assert.match(action, /default: "false"/);
    assert.match(action, /INPUT_REVIEW_DOCS: \$\{\{ inputs\.review_docs \}\}/);
  });
});
