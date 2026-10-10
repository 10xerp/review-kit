#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { buildReviewRecord, applyFindingReplies } from "./lib/record.mjs";
import { parseFindingReply } from "./lib/verdict.mjs";

const outPath = process.argv[2];
const payloadPath = process.argv[3];
if (!outPath || !payloadPath) {
  console.error("usage: write-record.mjs <out.json> <payload.json>");
  process.exit(2);
}

/** @type {Record<string, unknown>} */
const payload = JSON.parse(readFileSync(payloadPath, "utf8"));

/** @type {Array<{ findingId: string, reply: string }>} */
const replies = [];
if (Array.isArray(payload.reply_comment_bodies)) {
  for (const body of payload.reply_comment_bodies) {
    const parsed = parseFindingReply(String(body));
    if (parsed) replies.push(parsed);
  }
}

let findings = payload.findings ?? [];
if (replies.length) {
  findings = applyFindingReplies(findings, replies);
}

const record = buildReviewRecord({
  ...payload,
  findings,
  finding_replies: replies,
});

writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${outPath}\n`);
