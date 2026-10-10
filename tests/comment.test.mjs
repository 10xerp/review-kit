import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REVIEW_BOT,
  findReviewComment,
  parseReplies,
  readMeta,
  stampMeta,
  stripMeta,
  stripWorking,
} from "../scripts/claude-review/comment.mjs";

const bot = { login: REVIEW_BOT };

describe("findReviewComment", () => {
  const comments = [
    { id: 1, user: bot, body: "# Review: Blocked", updated_at: "2026-10-01T00:00:00Z" },
    { id: 2, user: bot, body: "Unrelated note", updated_at: "2026-10-05T00:00:00Z" },
    { id: 3, user: { login: "mallory" }, body: "# Review: Approved", updated_at: "2026-10-09T00:00:00Z" },
    { id: 4, user: bot, body: "x\n<!-- claude-review:v1\nlast_sha=abc\n-->", updated_at: "2026-10-03T00:00:00Z" },
  ];

  it("returns the latest review comment by the Claude app", () => {
    assert.equal(findReviewComment(comments).id, 4);
  });

  it("ignores review comments from anyone else", () => {
    assert.equal(findReviewComment([comments[2]]), null);
  });

  it("only returns a comment updated since the run started", () => {
    assert.equal(findReviewComment(comments, "2026-10-02T00:00:00Z").id, 4);
    assert.equal(findReviewComment(comments, "2026-10-04T00:00:00Z"), null);
  });

  it("accepts legacy Merge Decision comments", () => {
    assert.equal(findReviewComment([{ id: 9, user: bot, body: "### Merge Decision: YES", updated_at: "" }]).id, 9);
  });
});

describe("review metadata", () => {
  it("round-trips the hub meta block", () => {
    const stamped = stampMeta("# Review: Blocked\n\n## Issues (Must Fix)\n- [F1] a.ts:1 [security]: x\n", "abc123", "77", "blocked");
    assert.ok(stamped.endsWith("<!-- claude-review:v1\nlast_sha=abc123\nrun_id=77\nverdict=blocked\n-->\n"));
    assert.deepEqual(readMeta(stamped), { last_sha: "abc123", run_id: "77", verdict: "blocked" });
  });

  it("replaces an existing meta block when stamping again", () => {
    const once = stampMeta("# Review: Approved", "aaa", "1", "approved");
    const twice = stampMeta(once, "bbb", "2", "approved");
    assert.equal(twice.match(/claude-review:v1/g).length, 1);
    assert.equal(readMeta(twice).last_sha, "bbb");
  });

  it("strips the meta block and trailing whitespace", () => {
    assert.equal(stripMeta("# Review: Approved\n\n<!-- claude-review:v1\nlast_sha=a\n-->\n"), "# Review: Approved");
    assert.equal(stripMeta("# Review: Approved\n\n"), "# Review: Approved");
  });

  it("reads nothing from a comment without meta", () => {
    assert.deepEqual(readMeta("# Review: Approved"), {});
  });

  it("removes the progress placeholder", () => {
    assert.equal(stripWorking("Claude Code is working… # Review: Approved"), " # Review: Approved");
    assert.equal(stripWorking("Claude Code is working... done"), " done");
  });
});

describe("parseReplies", () => {
  it("collects /fp, /nit and /wontfix replies from people and other bots", () => {
    const replies = parseReplies([
      { id: 1, user: { login: "alice" }, body: "/fp F2 guarded by middleware", created_at: "t1" },
      { id: 2, user: { login: "cursor[bot]" }, body: "/NIT f3" },
      { id: 3, user: { login: "bob" }, body: "/wontfix F1\nlegacy path, removed next sprint" },
      { id: 4, user: bot, body: "/fp F9 not from the review bot" },
      { id: 5, user: { login: "carol" }, body: "I think /fp F2 is right" },
    ]);
    assert.deepEqual(
      replies.map((r) => [r.finding_id, r.reply, r.reason, r.author]),
      [
        ["F2", "fp", "guarded by middleware", "alice"],
        ["F3", "nit", "", "cursor[bot]"],
        ["F1", "wontfix", "legacy path, removed next sprint", "bob"],
      ],
    );
    assert.equal(replies[0].comment_id, 1);
    assert.equal(replies[0].created_at, "t1");
  });
});
