#!/usr/bin/env node
import { parseReviewMeta } from "./lib/verdict.mjs";

const body = process.argv[2] ?? "";
const { meta } = parseReviewMeta(body);
const sha = meta?.head_sha;
process.stdout.write(typeof sha === "string" ? sha : "");
