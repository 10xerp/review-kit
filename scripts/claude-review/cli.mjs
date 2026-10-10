#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildContext,
  buildPrompt,
  buildRecord,
  evaluateReview,
  renderComment,
  renderStepSummary,
  usageFromClaude,
} from "./lib.mjs";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const env = process.env;

const commands = {
  // stdin: PR issue comments (JSON array) -> stdout: review context
  context() {
    return JSON.stringify(buildContext(JSON.parse(readFileSync(0, "utf8"))));
  },

  prompt(contextPath, standardsPath, diffPath, filesPath) {
    return buildPrompt({
      repository: env.GITHUB_REPOSITORY,
      pr: env.REVIEW_PR,
      headSha: env.REVIEW_HEAD_SHA,
      mode: env.REVIEW_MODE,
      fromSha: env.REVIEW_FROM_SHA,
      mergeBase: env.REVIEW_MERGE_BASE,
      standards: readFileSync(standardsPath, "utf8"),
      files: readFileSync(filesPath, "utf8").split("\n").filter(Boolean),
      diff: readFileSync(diffPath, "utf8"),
      context: readJson(contextPath),
    });
  },

  // Parses Claude's output once; comment.md and result.json are both derived from that parse.
  finalize(claudePath, contextPath, outDir) {
    const output = readJson(claudePath);
    if (output.is_error || output.subtype !== "success") {
      throw new Error(`Claude Code run failed (${output.subtype}): ${output.result ?? "no result"}`);
    }
    const review = evaluateReview(output.result, readJson(contextPath).previous);
    const usage = usageFromClaude(output);
    writeFileSync(join(outDir, "result.json"), JSON.stringify({ ...review, usage }));
    writeFileSync(
      join(outDir, "comment.md"),
      renderComment(review, {
        headSha: env.REVIEW_HEAD_SHA,
        mode: env.REVIEW_MODE,
        fromSha: env.REVIEW_FROM_SHA,
        usage,
      }),
    );
    return review.verdict;
  },

  // result.json is omitted when an earlier review of this code is reused.
  record(contextPath, phasesPath, resultPath) {
    const context = readJson(contextPath);
    const result = resultPath ? readJson(resultPath) : null;
    return JSON.stringify(
      buildRecord({
        env,
        mode: env.REVIEW_MODE,
        fromSha: env.REVIEW_FROM_SHA,
        context,
        review: result ?? context.previous,
        usage: result?.usage,
        phases: readJson(phasesPath),
      }),
      null,
      2,
    );
  },

  summary(recordPath) {
    return renderStepSummary(readJson(recordPath));
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
