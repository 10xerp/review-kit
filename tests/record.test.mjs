import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReviewRecord, parseExecutionFile } from "../scripts/claude-review/record.mjs";

describe("parseExecutionFile", () => {
  it("parses JSON execution metrics", () => {
    const raw = JSON.stringify({ duration_ms: 17151, num_turns: 5, total_cost_usd: 0.42 });
    assert.deepEqual(parseExecutionFile(raw), { duration_ms: 17151, num_turns: 5, total_cost_usd: 0.42 });
  });

  it("parses trailing JSON in a noisy log", () => {
    const raw = `some log\n${JSON.stringify({ duration_ms: 100, num_turns: 2 })}`;
    assert.equal(parseExecutionFile(raw).duration_ms, 100);
  });

  it("parses claude-code-action result object with nested modelUsage", () => {
    const raw = `{
  "type": "result",
  "subtype": "success",
  "duration_ms": 9969,
  "num_turns": 4,
  "total_cost_usd": 0.1787414,
  "modelUsage": {
    "claude-opus-5-5": {
      "contextWindow": 1000000
    }
  }
}`;
    assert.deepEqual(parseExecutionFile(raw), { duration_ms: 9969, num_turns: 4, total_cost_usd: 0.1787414 });
  });

  it("parses NDJSON execution log and prefers the result line", () => {
    const result = JSON.stringify({ type: "result", duration_ms: 20302, num_turns: 7, total_cost_usd: 0.25 });
    const raw = `${JSON.stringify({ type: "system", message: "init" })}\n${result}`;
    assert.equal(parseExecutionFile(raw).duration_ms, 20302);
  });

  it("parses the action's pretty-printed message array", () => {
    const raw = JSON.stringify(
      [{ type: "system", subtype: "init" }, { type: "result", duration_ms: 31000, num_turns: 9, total_cost_usd: 0.5 }],
      null,
      2,
    );
    assert.deepEqual(parseExecutionFile(raw), { duration_ms: 31000, num_turns: 9, total_cost_usd: 0.5 });
  });
});

describe("buildReviewRecord", () => {
  it("builds a schema-1 record with findings and replies", () => {
    const reply = { finding_id: "F1", reply: "fp", reason: "guarded upstream", author: "alice", comment_id: 5, created_at: "" };
    const record = buildReviewRecord({
      repo: "10xerp/hub",
      pr: 1,
      baseRef: "main",
      baseSha: "aaa",
      headSha: "bbb",
      lastSha: "ccc",
      mode: "full",
      source: "claude",
      verdict: "approved",
      findings: [
        { id: "F1", severity: "must_fix", path: "a.ts", line: 1, category: "security", text: "x", rawLine: "" },
        { id: "F2", severity: "should_fix", path: "b.ts", line: 2, category: "convention", text: "y", rawLine: "" },
      ],
      fixedIds: ["F2"],
      replies: [reply],
      model: "claude-opus-5-5",
      claudeCodeVersion: "2.1.296",
      actionSha: "abc",
      standardsSha256: "def",
      runId: "99",
      workflowRunUrl: "https://example.com",
      execution: { duration_ms: 8000, num_turns: 4, total_cost_usd: 0.1 },
      queueS: 2,
      wallS: 54,
      phases: { install_s: 3 },
    });
    assert.equal(record.schema, 1);
    assert.deepEqual(record.findings.map((f) => f.status), ["open", "fixed"]);
    assert.equal(record.metrics.duration_ms, 8000);
    assert.equal(record.metrics.queue_s, 2);
    assert.deepEqual(record.replies, [reply]);
  });
});
