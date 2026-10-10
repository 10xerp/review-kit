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

  it("records the model it passes to Claude", () => {
    const model = claudeArgs.find((a) => a.startsWith("--model ")).split(" ")[1];
    assert.equal(model, "claude-opus-5-5");
    assert.equal(action.match(/REVIEW_MODEL: (\S+)/)[1], model);
  });

  it("passes hub v14's claude_args plus the restricted-mode lockdown", () => {
    assert.deepEqual(claudeArgs, [
      "--strict-mcp-config",
      "--restricted",
      '--tools "Bash,Glob,Grep,Read"',
      '--disallowedTools "Bash(git add:*),Bash(git commit:*),Bash(git rm:*)"',
      "--model claude-opus-5-5",
      "--max-turns 22",
      '--allowedTools "Glob,Grep,LS,Read,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git rev-parse:*)"',
    ]);
    assert.match(claudeArgs.join(" "), /Bash\(git diff:\*\)/);
  });

  it("denies Read, Grep and Glob under .git via Claude settings", () => {
    const settings = JSON.parse(action.match(/settings: \|\n((?: {10}.*\n)+)/)[1].replace(/^ {10}/gm, ""));
    assert.deepEqual(settings.permissions.deny, [
      "Read(.git/**)",
      "Read(**/.git/**)",
      "Grep(.git/**)",
      "Glob(.git/**)",
    ]);
  });

  it("skips install and Claude when workflow validation would fail", () => {
    assert.match(action, /skip_workflow_validation != 'true'/);
  });
});
