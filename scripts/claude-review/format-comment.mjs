#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { formatStickyComment, isReviewVerdict } from "./lib/verdict.mjs";

const verdict = process.argv[2];
const summaryPath = process.argv[3];
const outPath = process.argv[4];
const metaPath = process.argv[5];

if (!isReviewVerdict(verdict)) {
  console.error(`invalid verdict: ${verdict}`);
  process.exit(2);
}

const summary = readFileSync(summaryPath, "utf8");
/** @type {Record<string, unknown>} */
let extra = {};
if (metaPath) {
  extra = JSON.parse(readFileSync(metaPath, "utf8"));
}

writeFileSync(outPath, formatStickyComment(verdict, summary, extra));
