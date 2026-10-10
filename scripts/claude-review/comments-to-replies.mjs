#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseFindingReply } from "./lib/verdict.mjs";

const raw = readFileSync(0, "utf8");
/** @type {Array<{ body?: string }>} */
let comments = [];
try {
  comments = JSON.parse(raw);
} catch {
  comments = [];
}

const replies = [];
for (const c of comments) {
  const parsed = parseFindingReply(String(c?.body ?? ""));
  if (parsed) replies.push(parsed);
}
process.stdout.write(`${JSON.stringify(replies, null, 2)}\n`);
