import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workflowContentsDiffer } from "../scripts/claude-review/workflow.mjs";

describe("workflowContentsDiffer", () => {
  it("is false when both sides are missing", () => {
    assert.equal(workflowContentsDiffer("", "", { headExists: false, baseExists: false }), false);
  });

  it("is true when only one side has the workflow file", () => {
    assert.equal(workflowContentsDiffer("a", "", { headExists: true, baseExists: false }), true);
    assert.equal(workflowContentsDiffer("", "b", { headExists: false, baseExists: true }), true);
  });

  it("is true when contents differ", () => {
    assert.equal(workflowContentsDiffer("v2", "v1"), true);
  });

  it("is false when contents match", () => {
    assert.equal(workflowContentsDiffer("same", "same"), false);
  });
});
