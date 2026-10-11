#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findReviewComment, parseReplies, readMeta, stampMeta, stripMeta, stripWorking } from "./comment.mjs";
import { assignFindingIds } from "./findings.mjs";
import { buildPrompt, openFindingsWithReplies } from "./prompt.mjs";
import { buildReviewRecord, parseExecutionFile } from "./record.mjs";
import { reviewScope } from "./scope.mjs";
import { parseVerdictLine, resolveReview, verdictSummary } from "./verdict.mjs";

const env = process.env;
const REVIEW_MODEL = "claude-opus-5-5";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);

function phaseDurations(phases) {
  const dur = (a, b) => (typeof a === "number" && typeof b === "number" ? b - a : null);
  return {
    ...phases,
    prep_s: dur(phases.job_started, phases.prep_done),
    install_s: dur(phases.prep_done, phases.install_done),
    model_s: dur(phases.install_done, phases.model_done),
    finalize_s: dur(phases.model_done, phases.finalize_done),
  };
}

const commands = {
  // stdin: files changed by the PR, one per line
  scope(workflowPath) {
    const reviewDocs = env.INPUT_REVIEW_DOCS === "true";
    return JSON.stringify(
      reviewScope(readFileSync(0, "utf8").split("\n"), workflowPath, { reviewDocs }),
    );
  },

  // Writes the previous review comment, metadata included, to bodyPath.
  prior(commentsPath, bodyPath) {
    const comments = readJson(commentsPath);
    const comment = findReviewComment(comments);
    const body = comment?.body ?? "";
    writeFileSync(bodyPath, body);
    const meta = readMeta(body);
    return JSON.stringify({
      prior_comment_id: comment?.id ?? "",
      last_sha: meta.last_sha ?? "",
      prior_verdict: meta.verdict ?? "",
      max_id: Number(meta.max_id ?? 0) || 0,
      open_findings: openFindingsWithReplies(stripMeta(body), parseReplies(comments)),
    });
  },

  prompt(statePath, standardsPath) {
    const state = readJson(statePath);
    return buildPrompt({
      repo: env.GITHUB_REPOSITORY,
      pr: state.pr,
      headSha: state.head_sha,
      baseRef: state.base_ref,
      mode: state.review_mode,
      diffInstruction: state.diff_instruction,
      lastSha: state.last_sha,
      openFindings: state.open_findings,
      standards: readFileSync(standardsPath, "utf8"),
    });
  },

  "tooling-record"(workDir, skipReason, pr, headSha, baseRef, baseSha, runStarted, jobStarted, standardsSha256, commentsPath) {
    const comments = existsSync(commentsPath) ? readJson(commentsPath) : [];
    const phasesPath = join(workDir, "phases.json");
    const phases = existsSync(phasesPath) ? readJson(phasesPath) : { job_started: jobStarted };
    const queueS = env.COMMIT_TIME ? Math.max(0, epoch(runStarted) - epoch(env.COMMIT_TIME)) : null;
    const record = buildReviewRecord({
      repo: env.GITHUB_REPOSITORY,
      pr: Number(pr),
      baseRef,
      baseSha,
      headSha,
      lastSha: "",
      mode: "skipped",
      source: "tooling",
      verdict: "skipped",
      skipReason,
      findings: [],
      fixedIds: [],
      replies: parseReplies(comments),
      model: REVIEW_MODEL,
      claudeCodeVersion: "",
      actionSha: env.CLAUDE_CODE_ACTION_SHA ?? "",
      standardsSha256: standardsSha256 ?? "",
      runId: env.GITHUB_RUN_ID,
      workflowRunUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
      execution: {},
      queueS: Number.isNaN(queueS) ? null : queueS,
      wallS: Math.floor(Date.now() / 1000) - jobStarted,
      phases: phaseDurations(phases),
    });
    writeFileSync(join(workDir, "review-record.json"), `${JSON.stringify(record, null, 2)}\n`);
    return "{}";
  },

  finalize(statePath, commentsPath, phasesPath, workDir) {
    const state = readJson(statePath);
    const comments = readJson(commentsPath);
    const source = state.skip_model ? "carry_forward" : "claude";
    const priorBody = readFileSync(state.prior_body_file, "utf8");

    let body = stripMeta(priorBody);
    let verdict = state.prior_verdict;
    let commentId = state.prior_comment_id;
    if (source === "claude") {
      const comment = findReviewComment(comments, state.run_started);
      if (!comment) throw new Error(`No review comment from this run (started ${state.run_started}).`);
      body = stripMeta(stripWorking(comment.body));
      verdict = parseVerdictLine(body);
      commentId = comment.id;
    }

    const assigned = assignFindingIds(body, priorBody, { maxId: Number(state.max_id ?? 0) || 0 });
    const review = resolveReview(assigned.body, verdict);
    if (!review.verdict) throw new Error("Could not parse review verdict.");
    const stamped = stampMeta(review.body, state.head_sha, env.GITHUB_RUN_ID, review.verdict, {
      max_id: assigned.maxId,
    });

    let execution = {};
    if (env.EXECUTION_FILE) {
      try {
        execution = parseExecutionFile(readFileSync(env.EXECUTION_FILE, "utf8"));
      } catch {
        execution = {};
      }
    }
    const installMeta = join(workDir, "claude-code-bin", "install-meta.json");
    const queueS = env.COMMIT_TIME ? Math.max(0, epoch(state.run_started) - epoch(env.COMMIT_TIME)) : null;

    const record = buildReviewRecord({
      repo: env.GITHUB_REPOSITORY,
      pr: Number(state.pr),
      baseRef: state.base_ref,
      baseSha: state.base_sha,
      headSha: state.head_sha,
      lastSha: state.last_sha,
      mode: state.review_mode,
      source,
      verdict: review.verdict,
      findings: assigned.findings,
      fixedIds: assigned.fixedIds,
      dismissedIds: assigned.dismissedIds,
      carriedIds: assigned.carriedIds,
      replies: parseReplies(comments),
      model: REVIEW_MODEL,
      claudeCodeVersion: existsSync(installMeta) ? readJson(installMeta).version : "",
      actionSha: env.CLAUDE_CODE_ACTION_SHA,
      standardsSha256: state.standards_sha256,
      runId: env.GITHUB_RUN_ID,
      workflowRunUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
      execution,
      queueS: Number.isNaN(queueS) ? null : queueS,
      wallS: Math.floor(Date.now() / 1000) - state.job_started,
      phases: phaseDurations(readJson(phasesPath)),
    });

    writeFileSync(join(workDir, "review-record.json"), `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(join(workDir, "comment.json"), JSON.stringify({ body: stamped }));
    return JSON.stringify({
      comment_id: commentId,
      source,
      verdict: review.verdict,
      carried_ids: assigned.carriedIds,
      summary: verdictSummary(review.verdict),
      comment_length: stamped.length,
      patch_comment: true,
    });
  },
};

const [name, ...args] = process.argv.slice(2);
if (!commands[name]) {
  console.error(`usage: cli.mjs <${Object.keys(commands).join("|")}> ...`);
  process.exit(2);
}
try {
  process.stdout.write(`${commands[name](...args).trimEnd()}\n`);
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
