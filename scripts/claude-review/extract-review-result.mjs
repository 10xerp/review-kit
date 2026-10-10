#!/usr/bin/env node
/**
 * Parse Claude Code JSON output into verdict + findings + usage stats.
 * Expects final assistant message to include a JSON fence or review-kit-meta block.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isReviewVerdict, parseReviewMeta } from "./lib/verdict.mjs";

const inPath = process.argv[2];
const outPath = process.argv[3];
const raw = readFileSync(inPath, "utf8");

/** @type {Record<string, unknown>} */
let claudeJson = {};
try {
  claudeJson = JSON.parse(raw);
} catch {
  claudeJson = { result: raw };
}

const textParts = [];
if (typeof claudeJson.result === "string") textParts.push(claudeJson.result);
if (Array.isArray(claudeJson.messages)) {
  for (const m of claudeJson.messages) {
    if (m?.type === "assistant" && typeof m?.message?.content === "string") {
      textParts.push(m.message.content);
    }
  }
}
const combined = textParts.join("\n\n") || raw;

let verdict = null;
let findings = [];
let summary = combined;

const fenced = combined.match(/```json\s*([\s\S]*?)```/i);
if (fenced) {
  try {
    const parsed = JSON.parse(fenced[1]);
    if (isReviewVerdict(parsed.verdict)) verdict = parsed.verdict;
    if (Array.isArray(parsed.findings)) findings = parsed.findings;
    if (typeof parsed.summary === "string") summary = parsed.summary;
  } catch {
    /* fall through */
  }
}

const meta = parseReviewMeta(combined);
if (!verdict && meta.verdict) verdict = meta.verdict;

if (!verdict) {
  if (/blocked|must fix|must-fix/i.test(combined)) verdict = "blocked";
  else if (/approve_with_notes|approved with notes/i.test(combined)) {
    verdict = "approve_with_notes";
  } else {
    verdict = "approve";
  }
}

const usage = {
  model_time_ms: claudeJson.duration_ms ?? claudeJson.durationMs ?? null,
  turns: claudeJson.num_turns ?? claudeJson.numTurns ?? null,
  cost_usd: claudeJson.total_cost_usd ?? claudeJson.totalCostUsd ?? null,
};

writeFileSync(
  outPath,
  `${JSON.stringify({ verdict, findings, summary, usage }, null, 2)}\n`,
);
