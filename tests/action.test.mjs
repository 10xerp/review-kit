import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const action = readFileSync(new URL("../action.yml", import.meta.url), "utf8");
const claudeArgs = action.match(/claude_args: \|\n((?: {10}.*\n)+)/)[1].split("\n").map((l) => l.trim()).filter(Boolean);

describe("action.yml", () => {
  it("installs the Claude Code version pinned by the claude-code-action commit it runs", () => {
    const uses = action.match(/uses: anthropics\/claude-code-action@([0-9a-f]{40})/)[1];
    const pinned = [...action.matchAll(/CLAUDE_CODE_ACTION_SHA: ([0-9a-f]{40})/g)].map((m) => m[1]);
    assert.equal(pinned.length, 3);
    for (const sha of pinned) assert.equal(sha, uses);
  });

  it("uses a fixed model and turn limit", () => {
    assert.deepEqual(claudeArgs, [
      "--strict-mcp-config",
      "--restricted",
      '--tools "Bash,Glob,Grep,Read"',
      '--disallowedTools "Bash(git add:*),Bash(git commit:*),Bash(git rm:*)"',
      "--model claude-opus-5-5",
      "--max-turns 60",
      '--allowedTools "Glob,Grep,LS,Read,Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git rev-parse:*)"',
    ]);
    assert.match(claudeArgs.join(" "), /Bash\(git diff:\*\)/);
    assert.doesNotMatch(action, /^\s+model:/m);
    assert.doesNotMatch(action, /^\s+max_turns:/m);
    assert.doesNotMatch(action, /^\s+tooling_change:/m);
  });

  it("denies Read, Grep and Glob under .git and /proc via Claude settings", () => {
    const settings = JSON.parse(action.match(/settings: \|\n((?: {10}.*\n)+)/)[1].replace(/^ {10}/gm, ""));
    assert.deepEqual(settings.permissions.deny, [
      "Read(.git/**)",
      "Read(**/.git/**)",
      "Grep(.git/**)",
      "Glob(.git/**)",
      "Read(//proc/**)",
      "Grep(//proc/**)",
      "Glob(//proc/**)",
    ]);
  });

  it("uploads review records from prep when tooling blocks the model", () => {
    assert.match(action, /steps\.prep\.outputs\.record_path/);
    assert.match(action, /steps\.finalize\.outputs\.record_path \|\| steps\.prep\.outputs\.record_path/);
  });

  it("exposes review_docs for docs-heavy repos", () => {
    assert.match(action, /^\s+review_docs:\n/m);
    assert.match(action, /default: "false"/);
    assert.match(action, /INPUT_REVIEW_DOCS: \$\{\{ inputs\.review_docs \}\}/);
  });

  it("posts a comment per run by default and lets a repo keep one sticky comment", () => {
    assert.match(action, /^\s+sticky_comment:\n(?:.*\n)*?\s+default: "false"/m);
    assert.match(action, /use_sticky_comment: \$\{\{ inputs\.sticky_comment \}\}/);
    assert.match(action, /INPUT_STICKY_COMMENT: \$\{\{ inputs\.sticky_comment \}\}/);
  });
});
