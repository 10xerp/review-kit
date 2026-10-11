import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignFindingIds,
  extractFindingsFromBody,
  extractOpenFindingsForPrompt,
  parseFindingLine,
  parseFixedIds,
  parseResolvedIds,
} from "../scripts/claude-review/findings.mjs";

describe("parseFindingLine", () => {
  it("parses a finding without id", () => {
    const f = parseFindingLine("- app/foo.ts:12 [security]: missing auth", "must_fix");
    assert.equal(f.path, "app/foo.ts");
    assert.equal(f.line, 12);
    assert.equal(f.category, "security");
    assert.equal(f.text, "missing auth");
  });

  it("parses a finding with id", () => {
    const f = parseFindingLine("- [F2] lib/x.ts:1 [convention]: typo", "should_fix");
    assert.equal(f?.id, "F2");
  });
});

describe("assignFindingIds", () => {
  it("assigns new ids on first review", () => {
    const body = `# Review: Blocked

## Issues (Must Fix)
- app/a.ts:1 [security]: open redirect
`;
    const { body: stamped, findings } = assignFindingIds(body, "");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].id, "F1");
    assert.ok(stamped.includes("- [F1] app/a.ts:1 [security]: open redirect"));
  });

  it("reuses ids when path line category match", () => {
    const prior = `# Review: Blocked

## Issues (Must Fix)
- [F1] app/a.ts:1 [security]: open redirect
`;
    const body = `# Review: Blocked

## Issues (Must Fix)
- app/a.ts:1 [security]: still bad
`;
    const { findings } = assignFindingIds(body, prior);
    assert.equal(findings[0].id, "F1");
  });

  it("detects fixed ids from Fixed lines and removed findings", () => {
    const prior = `# Review: Blocked

## Issues (Must Fix)
- [F1] app/a.ts:1 [security]: open redirect
- [F2] lib/b.ts:2 [correctness]: off by one
`;
    const body = `# Review: Blocked

Fixed: F1

## Issues (Must Fix)
- lib/b.ts:2 [correctness]: off by one
`;
    const { fixedIds } = assignFindingIds(body, prior);
    assert.ok(fixedIds.includes("F1"));
    assert.ok(!fixedIds.includes("F2"));
  });

  it("continues numbering from max_id so IDs never repeat on a PR", () => {
    const body = "## Issues (Must Fix)\n- a.ts:1 [security]: x\n";
    const { findings, maxId } = assignFindingIds(body, "", { maxId: 6 });
    assert.deepEqual(findings.map((f) => f.id), ["F7"]);
    assert.equal(maxId, 7);
  });

  it("keeps an id the model wrote when it matches a prior finding, even at a new line", () => {
    const prior = "## Issues (Must Fix)\n- [F2] a.ts:1 [security]: x\n";
    const body = "## Issues (Must Fix)\n- [F2] a.ts:9 [security]: x moved\n- [F8] b.ts:1 [security]: unknown id\n";
    assert.deepEqual(
      assignFindingIds(body, prior).findings.map((f) => f.id),
      ["F2", "F3"],
    );
  });

  it("carries an unclosed Must Fix forward under Issues and leaves Suggestions behind", () => {
    const prior = `# Review: Blocked

## Issues (Must Fix)
- [F1] app/a.ts:1 [security]: open redirect
- [F2] lib/b.ts:2 [correctness]: off by one

## Suggestions (Should Fix)
- [F3] lib/c.ts:3 [convention]: naming
`;
    const body = "# Review: Approved\n\nFixed: F2\n";
    const r = assignFindingIds(body, prior);
    assert.equal(
      r.body,
      "# Review: Approved\n\nFixed: F2\n\n## Issues (Must Fix)\n- [F1] app/a.ts:1 [security]: open redirect (still open from an earlier review)\n",
    );
    assert.deepEqual(r.carriedIds, ["F1"]);
    assert.deepEqual(r.fixedIds, ["F2", "F3"]);
    assert.deepEqual(r.findings.map((f) => [f.id, f.severity]), [["F1", "must_fix"]]);
  });

  it("appends carried findings to an existing Issues section without doubling the note", () => {
    const prior = "## Issues (Must Fix)\n- [F1] a.ts:1 [security]: x (still open from an earlier review)\n";
    const body = "# Review: Blocked\n\n## Issues (Must Fix)\n- b.ts:2 [correctness]: y\n\n## Suggestions (Should Fix)\n- c.ts:3 [convention]: z\n";
    const r = assignFindingIds(body, prior);
    assert.equal(
      r.body,
      "# Review: Blocked\n\n## Issues (Must Fix)\n- [F2] b.ts:2 [correctness]: y\n- [F1] a.ts:1 [security]: x (still open from an earlier review)\n\n## Suggestions (Should Fix)\n- [F3] c.ts:3 [convention]: z\n",
    );
  });

  it("closes a Must Fix on a Dismissed line", () => {
    const prior = "## Issues (Must Fix)\n- [F1] a.ts:1 [security]: x\n";
    const r = assignFindingIds("# Review: Approved\n\nDismissed: F1\n", prior);
    assert.deepEqual(r.dismissedIds, ["F1"]);
    assert.deepEqual(r.carriedIds, []);
    assert.doesNotMatch(r.body, /Issues/);
  });

  it("gives new findings the next unused id", () => {
    const prior = "## Issues (Must Fix)\n- [F3] a.ts:1 [security]: x\n";
    const body = "## Issues (Must Fix)\n- a.ts:1 [security]: x\n- b.ts:2 [correctness]: y\n";
    assert.deepEqual(
      assignFindingIds(body, prior).findings.map((f) => f.id),
      ["F3", "F4"],
    );
  });
});

describe("parseFixedIds", () => {
  it("reads Fixed lines", () => {
    assert.deepEqual(parseFixedIds("Fixed: F2\nFixed: F3"), ["F2", "F3"]);
  });

  it("separates Fixed from Dismissed", () => {
    assert.deepEqual(parseResolvedIds("Fixed: F2\nDismissed: F3 (fp)\nFixed: F4"), { fixed: ["F2", "F4"], dismissed: ["F3"] });
  });
});

describe("extractFindingsFromBody", () => {
  it("collects must fix and suggestions", () => {
    const body = `# Review: Approve with notes

## Issues (Must Fix)
- [F1] a.ts:1 [security]: x

## Suggestions (Should Fix)
- [F2] b.ts:2 [maintainability]: y
`;
    assert.deepEqual(
      extractFindingsFromBody(body).map((f) => f.id),
      ["F1", "F2"],
    );
  });
});

describe("extractOpenFindingsForPrompt", () => {
  it("lists only Must Fix findings", () => {
    const body = "## Issues (Must Fix)\n- [F1] a.ts:1 [security]: x\n\n## Suggestions (Should Fix)\n- [F2] b.ts:2 [maintainability]: y\n";
    assert.equal(extractOpenFindingsForPrompt(body), "- [F1] a.ts:1 [security]: x");
  });
});
