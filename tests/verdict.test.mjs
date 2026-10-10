import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseReviewMeta,
  reviewGateFails,
  VERDICT_HEADINGS,
  formatStickyComment,
  parseFindingReply,
  hasOpenMustFix,
} from "../scripts/claude-review/lib/verdict.mjs";

describe("parseReviewMeta", () => {
  it("reads verdict from JSON meta (single source of truth)", () => {
    const body = formatStickyComment(
      "approve_with_notes",
      "Looks good with nits.",
      { head_sha: "abc" },
    );
    const { verdict } = parseReviewMeta(body);
    assert.equal(verdict, "approve_with_notes");
  });

  it("ignores mismatched visible heading (hub PR #1977 class bug)", () => {
    const body = `<!-- review-kit-meta {"verdict":"approve_with_notes","version":1} -->

# Review: Blocked

Some must-fix sounding prose that must not drive the gate.`;

    const { verdict } = parseReviewMeta(body);
    assert.equal(verdict, "approve_with_notes");
    assert.equal(reviewGateFails(verdict, []), false);
  });
});

describe("reviewGateFails", () => {
  it("fails on blocked verdict", () => {
    assert.equal(reviewGateFails("blocked", []), true);
  });

  it("fails on open must_fix even when verdict is approve_with_notes", () => {
    assert.equal(
      reviewGateFails("approve_with_notes", [
        { id: "F1", severity: "must_fix" },
      ]),
      true,
    );
  });

  it("passes approve_with_notes without must_fix", () => {
    assert.equal(
      reviewGateFails("approve_with_notes", [
        { id: "F1", severity: "nit", reply: "nit" },
      ]),
      false,
    );
  });

  it("respects /fp dismissal on must_fix", () => {
    assert.equal(
      reviewGateFails("approve_with_notes", [
        { id: "F1", severity: "must_fix", reply: "fp", dismissed: true },
      ]),
      false,
    );
  });
});

describe("headings derive from verdict", () => {
  it("maps approve_with_notes heading consistently", () => {
    assert.equal(VERDICT_HEADINGS.approve_with_notes, "Review: Approved with notes");
    const body = formatStickyComment("approve_with_notes", "ok", {});
    assert.match(body, /^# Review: Approved with notes/m);
    assert.doesNotMatch(body, /^# Review: Blocked/m);
  });
});

describe("parseFindingReply", () => {
  it("parses /fp F1", () => {
    assert.deepEqual(parseFindingReply("/fp F1"), {
      reply: "fp",
      findingId: "F1",
    });
  });

  it("parses /wontfix finding-2", () => {
    assert.deepEqual(parseFindingReply("/wontfix finding-2"), {
      reply: "wontfix",
      findingId: "finding-2",
    });
  });
});

describe("hasOpenMustFix", () => {
  it("detects open must_fix", () => {
    assert.equal(hasOpenMustFix([{ severity: "must_fix" }]), true);
  });
});
