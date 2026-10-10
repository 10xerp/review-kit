import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOT_LOGIN,
  HEADINGS,
  assignFindingIds,
  buildContext,
  buildPrompt,
  buildRecord,
  decodeMeta,
  encodeMeta,
  evaluateReview,
  findStickyComment,
  parseModelOutput,
  parseReplies,
  renderComment,
  resolveVerdict,
} from "../scripts/claude-review/lib.mjs";

const answer = (data, prefix = "Done reviewing.") => `${prefix}\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`;
const finding = (severity, extra = {}) => ({ id: null, severity, title: `${severity} issue`, ...extra });
const bot = (id, body) => ({ id, body, user: { login: BOT_LOGIN } });
const human = (id, body, login = "alice") => ({ id, body, user: { login }, created_at: "2026-10-10T00:00:00Z" });

describe("parseModelOutput", () => {
  it("reads verdict, summary and findings from the last json block", () => {
    const text = `${answer({ verdict: "approve", summary: "old", findings: [] })}\n${answer({
      verdict: "blocked",
      summary: " Needs work ",
      findings: [finding("must_fix", { path: "a.ts", line: 3, body: "fix it" })],
    })}`;
    const parsed = parseModelOutput(text);
    assert.equal(parsed.verdict, "blocked");
    assert.equal(parsed.summary, "Needs work");
    assert.deepEqual(parsed.findings, [
      { id: null, severity: "must_fix", title: "must_fix issue", body: "fix it", path: "a.ts", line: 3 },
    ]);
  });

  it("never falls back to prose: no json block is an error", () => {
    assert.throws(() => parseModelOutput("# Review: Approved\nLooks great"), /no ```json block/);
  });

  it("rejects invalid JSON, unknown verdicts and unknown severities", () => {
    assert.throws(() => parseModelOutput("```json\n{nope}\n```"), /invalid/);
    assert.throws(() => parseModelOutput(answer({ verdict: "lgtm", summary: "", findings: [] })), /unknown verdict/);
    assert.throws(
      () => parseModelOutput(answer({ verdict: "approve", summary: "", findings: [finding("critical")] })),
      /unknown severity/,
    );
    assert.throws(
      () => parseModelOutput(answer({ verdict: "approve", summary: "", findings: [{ severity: "nit" }] })),
      /title is required/,
    );
  });
});

describe("resolveVerdict", () => {
  it("blocks on a blocked verdict or any Must Fix", () => {
    assert.equal(resolveVerdict("blocked", []), "blocked");
    assert.equal(resolveVerdict("approve", [finding("must_fix")]), "blocked");
    assert.equal(resolveVerdict("approve_with_notes", [finding("nit"), finding("must_fix")]), "blocked");
  });

  it("never approves outright when findings exist", () => {
    assert.equal(resolveVerdict("approve", [finding("nit")]), "approve_with_notes");
    assert.equal(resolveVerdict("approve_with_notes", []), "approve_with_notes");
    assert.equal(resolveVerdict("approve", []), "approve");
  });
});

describe("assignFindingIds", () => {
  it("keeps carried-forward ids and numbers new findings after the highest id ever used", () => {
    const previous = { last_id: 4, findings: [{ id: "F2" }, { id: "F4" }] };
    const { findings, lastId } = assignFindingIds(
      [finding("nit", { id: "F4" }), finding("nit", { id: "F3" }), finding("nit"), finding("nit", { id: "F4" })],
      previous,
    );
    assert.deepEqual(
      findings.map((f) => f.id),
      ["F4", "F5", "F6", "F7"],
    );
    assert.equal(lastId, 7);
  });

  it("starts at F1 without a previous review", () => {
    assert.deepEqual(
      assignFindingIds([finding("nit", { id: "F9" })], null).findings.map((f) => f.id),
      ["F1"],
    );
  });
});

describe("renderComment", () => {
  const info = { headSha: "a".repeat(40), mode: "full", fromSha: "", usage: { num_turns: 7, total_cost_usd: 0.4 } };

  for (const modelVerdict of ["approve", "approve_with_notes", "blocked"]) {
    for (const severities of [[], ["nit"], ["should_fix"], ["must_fix"]]) {
      it(`heading, meta and gate agree (model said ${modelVerdict}, findings ${severities.join(",") || "none"})`, () => {
        const review = evaluateReview(
          answer({ verdict: modelVerdict, summary: "s", findings: severities.map((s) => finding(s)) }),
          null,
        );
        const body = renderComment(review, info);
        const headings = [...body.matchAll(/^## (Review: .*)$/gm)].map((m) => m[1]);
        assert.deepEqual(headings, [HEADINGS[review.verdict]]);
        assert.equal(decodeMeta(body).verdict, review.verdict);
        const blocks = modelVerdict === "blocked" || severities.includes("must_fix");
        assert.equal(review.verdict === "blocked", blocks);
      });
    }
  }

  it("keeps the hidden meta intact when finding text contains -->", () => {
    const review = evaluateReview(
      answer({ verdict: "blocked", summary: "x --> y", findings: [finding("must_fix", { title: "a --> b" })] }),
      null,
    );
    const meta = decodeMeta(renderComment(review, info));
    assert.equal(meta.verdict, "blocked");
    assert.equal(meta.findings[0].title, "a --> b");
    assert.equal(meta.head_sha, info.headSha);
    assert.equal(meta.last_id, 1);
  });

  it("stays under GitHub's comment size limit", () => {
    const big = "x".repeat(40000);
    const review = evaluateReview(
      answer({ verdict: "blocked", summary: big, findings: [finding("must_fix", { body: big })] }),
      null,
    );
    const body = renderComment(review, info);
    assert.ok(body.length <= 65536);
    assert.equal(decodeMeta(body).verdict, "blocked");
  });
});

describe("PR comment context", () => {
  it("only trusts sticky comments posted by the workflow bot, latest first", () => {
    const comments = [
      bot(1, encodeMeta({ verdict: "blocked", head_sha: "old" })),
      bot(2, encodeMeta({ verdict: "approve", head_sha: "new" })),
      human(3, encodeMeta({ verdict: "approve", head_sha: "forged" })),
      bot(4, "unrelated bot comment"),
    ];
    assert.deepEqual(findStickyComment(comments), { id: 2, meta: { verdict: "approve", head_sha: "new" } });
    assert.equal(findStickyComment([human(5, encodeMeta({ verdict: "approve" }))]), null);
  });

  it("parses /fp, /nit and /wontfix replies from humans", () => {
    const replies = parseReplies([
      human(10, "/fp f3 the value is validated upstream"),
      human(11, "/WONTFIX F1"),
      human(12, "I think /nit F2 is fine"),
      bot(13, "/fp F9"),
    ]);
    assert.deepEqual(replies, [
      {
        finding_id: "F3",
        reply: "fp",
        reason: "the value is validated upstream",
        author: "alice",
        comment_id: 10,
        created_at: "2026-10-10T00:00:00Z",
      },
      { finding_id: "F1", reply: "wontfix", reason: "", author: "alice", comment_id: 11, created_at: "2026-10-10T00:00:00Z" },
    ]);
  });

  it("builds an empty context for a PR without reviews", () => {
    assert.deepEqual(buildContext([]), { sticky_comment_id: null, previous: null, replies: [] });
  });
});

describe("buildPrompt", () => {
  const base = {
    repository: "10xerp/hub",
    pr: "12",
    headSha: "h".repeat(40),
    mode: "full",
    fromSha: "",
    mergeBase: "m".repeat(40),
    standards: "Must Fix: tenant leaks.",
    files: ["src/a.ts"],
    diff: "+const a = 1;\n",
    context: { previous: null, replies: [] },
  };

  it("includes standards, files and diff", () => {
    const prompt = buildPrompt(base);
    assert.match(prompt, /Must Fix: tenant leaks\./);
    assert.match(prompt, /- src\/a\.ts/);
    assert.match(prompt, /```diff\n\+const a = 1;\n\n```/);
  });

  it("uses a fence longer than any backtick run in the diff", () => {
    const prompt = buildPrompt({ ...base, diff: "+```js\n+x\n+```\n" });
    assert.match(prompt, /````diff\n/);
  });

  it("lists previous findings with replies for re-reviews", () => {
    const prompt = buildPrompt({
      ...base,
      mode: "incremental",
      fromSha: "p".repeat(40),
      context: {
        previous: { findings: [{ id: "F1", severity: "must_fix", title: "SQL injection", path: "db.ts", line: 9 }] },
        replies: [{ finding_id: "F1", reply: "fp", reason: "parameterized", author: "bob" }],
      },
    });
    assert.match(prompt, /last reviewed at p{40}/);
    assert.match(prompt, /- F1 \[must_fix\] `db\.ts:9` SQL injection\n {2}- @bob replied \/fp: parameterized/);
  });
});

describe("buildRecord", () => {
  it("captures ids, usage, phases and replies", () => {
    const record = buildRecord({
      env: {
        GITHUB_REPOSITORY: "10xerp/hub",
        REVIEW_PR: "12",
        GITHUB_RUN_ID: "99",
        GITHUB_RUN_ATTEMPT: "1",
        REVIEW_HEAD_SHA: "h",
        REVIEW_BASE_SHA: "b",
      },
      mode: "incremental",
      fromSha: "p",
      context: { replies: [{ finding_id: "F1", reply: "nit" }] },
      review: { verdict: "blocked", findings: [{ id: "F1", severity: "must_fix", title: "t", body: "b", path: null, line: null }] },
      usage: { num_turns: 3, total_cost_usd: 0.2, duration_api_ms: 900 },
      phases: { claude: 1000 },
    });
    assert.equal(record.check, "fail");
    assert.equal(record.pr_number, 12);
    assert.deepEqual(record.findings, [{ id: "F1", severity: "must_fix", title: "t", path: null, line: null }]);
    assert.equal(record.usage.num_turns, 3);
    assert.deepEqual(record.phases_ms, { claude: 1000 });
    assert.deepEqual(record.replies, [{ finding_id: "F1", reply: "nit" }]);
  });
});
