import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReviewRecord,
  applyFindingReplies,
} from "../scripts/claude-review/lib/record.mjs";

describe("buildReviewRecord", () => {
  it("includes usage and phases", () => {
    const record = buildReviewRecord({
      review_id: "rk-1",
      repository: "10xerp/hub",
      pr_number: 1977,
      head_sha: "sha",
      verdict: "approve",
      model_time_ms: 1000,
      turns: 3,
      cost_usd: 0.12,
      phases_ms: { claude_run: 900 },
    });
    assert.equal(record.schema, "review-kit-record-v1");
    assert.equal(record.usage.turns, 3);
    assert.equal(record.phases_ms.claude_run, 900);
  });
});

describe("applyFindingReplies", () => {
  it("marks fp/wontfix as dismissed", () => {
    const out = applyFindingReplies(
      [{ id: "F1", severity: "must_fix" }],
      [{ findingId: "F1", reply: "fp" }],
    );
    assert.equal(out[0].reply, "fp");
    assert.equal(out[0].dismissed, true);
  });
});
