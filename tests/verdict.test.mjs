import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HEADINGS, hasMustFix, parseVerdictLine, resolveReview } from "../scripts/claude-review/verdict.mjs";

describe("parseVerdictLine", () => {
  it("parses v13 review headers", () => {
    assert.equal(parseVerdictLine("# Review: Approved\n"), "approved");
    assert.equal(parseVerdictLine("# Review: Blocked\n\n## Issues"), "blocked");
    assert.equal(parseVerdictLine("# Review: Approve with notes\n"), "approve_with_notes");
  });

  it("parses legacy merge decision lines", () => {
    assert.equal(parseVerdictLine("### Merge Decision: NO\n"), "blocked");
  });

  it("finds the heading below the action's progress header", () => {
    assert.equal(parseVerdictLine("**Claude finished**\n\n---\n# Review: Blocked\n"), "blocked");
  });

  it("returns empty when there is no verdict", () => {
    assert.equal(parseVerdictLine("Looks good to me."), "");
  });
});

describe("hasMustFix", () => {
  it("counts any line under Issues, formatted or not", () => {
    assert.equal(hasMustFix("## Issues (Must Fix)\n- broken thing without a path\n"), true);
    assert.equal(hasMustFix("## Suggestions (Should Fix)\n- [F1] a.ts:1 [convention]: x\n"), false);
    assert.equal(hasMustFix("## Issues (Must Fix)\n\n## Suggestions (Should Fix)\n- a.ts:1 [convention]: x\n"), false);
  });
});

describe("resolveReview (single verdict source)", () => {
  const mustFix = "\n## Issues (Must Fix)\n- [F1] a.ts:1 [security]: leak\n";
  const suggestion = "\n## Suggestions (Should Fix)\n- [F2] b.ts:2 [maintainability]: dup\n";

  for (const [heading, extra, expected] of [
    ["# Review: Blocked", mustFix, "blocked"],
    ["# Review: Approve with notes", mustFix, "blocked"],
    ["# Review: Approved", mustFix, "blocked"],
    ["# Review: Blocked", "", "blocked"],
    ["# Review: Approve with notes", suggestion, "approve_with_notes"],
    ["# Review: Approved", "", "approved"],
  ]) {
    it(`${heading}${extra ? " + findings" : ""} resolves to ${expected} with a matching heading`, () => {
      const review = resolveReview(`${heading}\n${extra}`, parseVerdictLine(heading));
      assert.equal(review.verdict, expected);
      assert.equal(parseVerdictLine(review.body), expected);
      assert.ok(review.body.includes(HEADINGS[expected]));
    });
  }

  it("blocks hub PR #1977: Blocked heading with an approve_with_notes verdict", () => {
    const review = resolveReview(`# Review: Blocked\n${mustFix}`, "approve_with_notes");
    assert.equal(review.verdict, "blocked");
  });

  it("rewrites a carried-forward heading that disagrees with its verdict", () => {
    const review = resolveReview("# Review: Approved\n", "blocked");
    assert.equal(review.body, "# Review: Blocked\n");
  });

  it("adds a heading to a legacy body when the verdict escalates", () => {
    const review = resolveReview(`### Merge Decision: YES\n${mustFix}`, "approved");
    assert.equal(review.verdict, "blocked");
    assert.ok(review.body.startsWith("# Review: Blocked\n"));
  });

  it("leaves an unparseable review without a verdict", () => {
    assert.equal(resolveReview(`No heading${mustFix}`, "").verdict, "");
  });
});
