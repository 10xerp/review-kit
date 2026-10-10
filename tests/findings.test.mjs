import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignFindingIds,
  extractFindingsFromBody,
  extractOpenFindingsForPrompt,
  parseFindingLine,
  parseFixedIds,
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
