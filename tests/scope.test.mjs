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

  it("skips docs-only PRs by default", () => {
    const r = reviewScope(["README.md", "docs/foo.md", "docs/diagram.svg", "logo.png"], WORKFLOW);
    assert.equal(r.review, false);
    assert.equal(r.images_only_skip, false);
  });

  it("skips an empty file list", () => {
    assert.equal(reviewScope([""], WORKFLOW).review, false);
  });

  describe("review_docs", () => {
    it("reviews markdown, docs paths, and CSV data files", () => {
      assert.equal(
        reviewScope(["README.md", "docs/hr/policy.md", "data/scenarios.csv", "market.md"], WORKFLOW, {
          reviewDocs: true,
        }).review,
        true,
      );
    });

    it("still skips image-only PRs", () => {
      const r = reviewScope(["logo.png", "docs/diagram.svg", "assets/chart.gif"], WORKFLOW, {
        reviewDocs: true,
      });
      assert.equal(r.review, false);
      assert.equal(r.images_only_skip, true);
    });

    it("reviews when docs and images change together", () => {
      assert.equal(
        reviewScope(["README.md", "logo.png"], WORKFLOW, { reviewDocs: true }).review,
        true,
      );
    });
  });
});
