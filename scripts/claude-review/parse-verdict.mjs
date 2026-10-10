#!/usr/bin/env node
/**
 * CLI: read review comment body (file or stdin), emit JSON for bash/jq.
 * Usage: parse-verdict.mjs [--body-file path] [--record-file path]
 */
import { readFileSync } from "node:fs";
import {
  parseReviewMeta,
  reviewGateFails,
  VERDICT_HEADINGS,
} from "./lib/verdict.mjs";
import { buildReviewRecord, applyFindingReplies } from "./lib/record.mjs";

function readArg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return null;
  return process.argv[i + 1];
}

function readBody() {
  const path = readArg("--body-file");
  if (path) return readFileSync(path, "utf8");
  if (!process.stdin.isTTY) {
    return readFileSync(0, "utf8");
  }
  return "";
}

const body = readBody();
const { verdict, meta } = parseReviewMeta(body);

let findings = [];
const recordPath = readArg("--record-file");
if (recordPath) {
  try {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    findings = record.findings ?? [];
    if (record.finding_replies?.length) {
      findings = applyFindingReplies(findings, record.finding_replies);
    }
  } catch {
    findings = [];
  }
}

const gateFails = reviewGateFails(verdict, findings);
const heading = verdict ? VERDICT_HEADINGS[verdict] : null;

const out = {
  verdict,
  heading,
  gate_fails: gateFails,
  meta,
};

process.stdout.write(`${JSON.stringify(out)}\n`);
