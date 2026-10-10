import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewScope } from "../scripts/claude-review/scope.mjs";

const WORKFLOW = ".github/workflows/claude-code-review.yml";

describe("claude-review scope", () => {
  it("reviews when only a non-review workflow changes", () => {
    assert.equal(reviewScope([".github/workflows/deploy.yml"], WORKFLOW).review, true);
  });

  it("skips when review tooling changes even with app code", () => {
    const r = reviewScope([WORKFLOW, "lib/foo.ts"], WORKFLOW);
    assert.equal(r.review, false);
    assert.equal(r.changes_review_tooling, true);
  });

  it("skips when only claude-code-review.yml changes", () => {
    const r = reviewScope([WORKFLOW], WORKFLOW);
    assert.equal(r.review, false);
    assert.equal(r.changes_review_tooling, true);
  });

  it("skips docs-only PRs", () => {
    assert.equal(reviewScope(["README.md", "docs/foo.md", "docs/diagram.svg", "logo.png"], WORKFLOW).review, false);
  });

  it("skips an empty file list", () => {
    assert.equal(reviewScope([""], WORKFLOW).review, false);
  });
});
