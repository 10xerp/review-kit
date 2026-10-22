import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bumpBranchName,
  bumpPullRequestTitle,
  findPinnedSha,
  parseConsumers,
  rewriteReviewKitUses,
} from "../scripts/release/lib.mjs";

describe("parseConsumers", () => {
  it("ignores comments and blank lines", () => {
    const repos = parseConsumers(`
# org repos
10xerp/hub

bd28/legacy
`);
    assert.deepEqual(repos.map((r) => r.fullName), ["10xerp/hub", "bd28/legacy"]);
  });
});

describe("rewriteReviewKitUses", () => {
  const sample = `
jobs:
  claude-review:
    steps:
      - uses: 10xerp/review-kit@b4cf21ec958bc976f2f78558d990e62c4d82f152 # v2
`;

  it("rewrites SHA and version comment", () => {
    const sha = "3673981432db46a9c759d415d5b8d00c0f17fa35";
    const { content, changed, previousSha } = rewriteReviewKitUses(sample, sha, "v4");
    assert.equal(changed, true);
    assert.equal(previousSha, "b4cf21ec958bc976f2f78558d990e62c4d82f152");
    assert.match(content, new RegExp(`10xerp/review-kit@${sha} # v4`));
  });

  it("is idempotent when already pinned", () => {
    const sha = "3673981432db46a9c759d415d5b8d00c0f17fa35";
    const pinned = sample.replace(
      /10xerp\/review-kit@[0-9a-f]{40}( # v2)?/,
      `10xerp/review-kit@${sha} # v4`,
    );
    const { changed } = rewriteReviewKitUses(pinned, sha, "v4");
    assert.equal(changed, false);
  });
});

describe("findPinnedSha", () => {
  it("returns the first review-kit pin", () => {
    const sha = findPinnedSha(
      "- uses: 10xerp/review-kit@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v1\n",
    );
    assert.equal(sha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });
});

describe("bump naming", () => {
  it("uses stable branch and title", () => {
    assert.equal(bumpPullRequestTitle("v4"), "Bump review-kit to v4");
    assert.equal(bumpBranchName("v4"), "review-kit/bump-v4");
  });
});
