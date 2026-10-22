#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bumpBranchName,
  bumpPullRequestTitle,
  collectWorkflowUpdates,
  findPinnedSha,
  parseConsumers,
  rewriteReviewKitUses,
} from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const KIT_OWNER = "10xerp";
const KIT_REPO = "review-kit";

/**
 * @param {string} path
 * @param {string} token
 * @param {RequestInit} [init]
 */
async function ghApi(path, token, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  /** @type {unknown} */
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "message" in body
        ? String(/** @type {{ message: string }} */ (body).message)
        : text;
    throw new Error(`GitHub API ${init.method ?? "GET"} ${path}: ${res.status} ${msg}`);
  }
  return body;
}

/**
 * @param {string} fromSha
 * @param {string} toSha
 * @param {string} token
 */
async function summarizeKitChanges(fromSha, toSha, token) {
  if (!fromSha || fromSha === toSha) {
    return "_No prior pin found in workflow files; see the release link for changes._";
  }
  try {
    const data = /** @type {{ commits?: { commit: { message: string } }[] }} */ (
      await ghApi(
        `/repos/${KIT_OWNER}/${KIT_REPO}/compare/${fromSha}...${toSha}`,
        token,
      )
    );
    const lines = (data.commits ?? []).map(
      (c) => `- ${c.commit.message.split("\n")[0]}`,
    );
    return lines.length ? lines.join("\n") : "_No commits between pins (same SHA)._";
  } catch (err) {
    return `_Could not load compare summary: ${err instanceof Error ? err.message : err}_`;
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} token
 */
async function getDefaultBranch(owner, repo, token) {
  const data = /** @type {{ default_branch: string }} */ (
    await ghApi(`/repos/${owner}/${repo}`, token)
  );
  return data.default_branch;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @param {string} token
 */
async function resolveRefSha(owner, repo, ref, token) {
  const data = /** @type {{ object: { sha: string } }} */ (
    await ghApi(`/repos/${owner}/${repo}/git/ref/${ref}`, token)
  );
  return data.object.sha;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} tag
 * @param {string} token
 */
async function findOpenBumpPull(owner, repo, tag, token) {
  const title = bumpPullRequestTitle(tag);
  const pulls = /** @type {{ number: number, title: string, head: { ref: string } }[]} */ (
    await ghApi(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`, token)
  );
  return pulls.find((p) => p.title === title) ?? null;
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} baseSha
 * @param {string} token
 */
async function ensureBranch(owner, repo, branch, baseSha, token) {
  const refPath = `heads/${branch}`;
  try {
    await ghApi(`/repos/${owner}/${repo}/git/ref/${refPath}`, token);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("404")) throw err;
    await ghApi(`/repos/${owner}/${repo}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 * @param {string} token
 */
async function listWorkflowEntries(owner, repo, branch, token) {
  try {
    return /** @type {{ name: string, type: string }[]} */ (
      await ghApi(
        `/repos/${owner}/${repo}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`,
        token,
      )
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return [];
    throw err;
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} path
 * @param {string} branch
 * @param {string} token
 */
async function readWorkflowFile(owner, repo, path, branch, token) {
  try {
    const data = /** @type {{ content: string, encoding: string }} */ (
      await ghApi(
        `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
        token,
      )
    );
    if (data.encoding !== "base64") throw new Error(`Unexpected encoding for ${path}`);
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} path
 * @param {string} branch
 * @param {string} content
 * @param {string | undefined} fileSha
 * @param {string} token
 */
async function writeWorkflowFile(owner, repo, path, branch, content, fileSha, token) {
  await ghApi(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: "PUT",
    body: JSON.stringify({
      message: `Bump review-kit pin on ${path}`,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      ...(fileSha ? { sha: fileSha } : {}),
    }),
  });
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {string} path
 * @param {string} branch
 * @param {string} token
 */
async function getFileSha(owner, repo, path, branch, token) {
  try {
    const data = /** @type {{ sha: string }} */ (
      await ghApi(
        `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
        token,
      )
    );
    return data.sha;
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return undefined;
    throw err;
  }
}

/**
 * @param {{ owner: string, repo: string, fullName: string }} consumer
 * @param {{ tag: string, sha: string, kitToken: string, ownerToken: string | null }} ctx
 * @returns {Promise<{ repo: string, status: string, detail: string }>}
 */
export async function bumpConsumerRepo(consumer, ctx) {
  const { owner, repo, fullName } = consumer;
  const { tag, sha, kitToken } = ctx;
  const token = ctx.ownerToken;
  if (!token) {
    return {
      repo: fullName,
      status: "failed",
      detail: `No GitHub App token for owner ${owner} (check repository secrets).`,
    };
  }

  const defaultBranch = await getDefaultBranch(owner, repo, token);
  const existingPr = await findOpenBumpPull(owner, repo, tag, token);
  const branch = existingPr?.head.ref ?? bumpBranchName(tag);

  if (!existingPr) {
    const baseSha = await resolveRefSha(owner, repo, `heads/${defaultBranch}`, token);
    await ensureBranch(owner, repo, branch, baseSha, token);
  }

  const entries = await listWorkflowEntries(owner, repo, branch, token);
  const readFile = (path) => readWorkflowFile(owner, repo, path, branch, token);
  const updates = await collectWorkflowUpdates(entries, readFile, sha, tag);

  if (updates.length === 0) {
    let foundPin = false;
    let alreadyPinned = true;
    for (const entry of entries) {
      if (entry.type !== "file" || !/\.(ya?ml)$/i.test(entry.name)) continue;
      const path = `.github/workflows/${entry.name}`;
      const raw = await readWorkflowFile(owner, repo, path, branch, token);
      if (!raw) continue;
      const pinned = findPinnedSha(raw);
      if (!pinned) continue;
      foundPin = true;
      const { changed } = rewriteReviewKitUses(raw, sha, tag);
      if (changed || pinned !== sha.toLowerCase()) alreadyPinned = false;
    }
    if (!foundPin) {
      return {
        repo: fullName,
        status: "skipped",
        detail: "No 10xerp/review-kit uses: lines under .github/workflows.",
      };
    }
    if (alreadyPinned) {
      return { repo: fullName, status: "skipped", detail: "Already pinned to release SHA." };
    }
    return {
      repo: fullName,
      status: "failed",
      detail: "Found review-kit pins but could not rewrite them (unexpected workflow format).",
    };
  }

  /** @type {string | null} */
  let previousSha = null;
  for (const update of updates) {
    if (update.previousSha && !previousSha) previousSha = update.previousSha;
    const fileSha = await getFileSha(owner, repo, update.path, branch, token);
    await writeWorkflowFile(
      owner,
      repo,
      update.path,
      branch,
      update.content,
      fileSha,
      token,
    );
  }

  const compareFrom = previousSha ?? sha;
  const releaseUrl = `https://github.com/${KIT_OWNER}/${KIT_REPO}/releases/tag/${encodeURIComponent(tag)}`;
  const compareUrl = `https://github.com/${KIT_OWNER}/${KIT_REPO}/compare/${compareFrom}...${sha}`;
  const changeSummary = await summarizeKitChanges(previousSha ?? compareFrom, sha, kitToken);
  const body = [
    `Automated bump to [review-kit ${tag}](${releaseUrl}) (\`${sha}\`).`,
    "",
    "**Compare:**",
    compareUrl,
    "",
    "**Changes since the previous pin:**",
    changeSummary,
    "",
    "The `claude-review` check is expected to fail on this PR because it updates the review workflow; merge with an admin bypass.",
  ].join("\n");

  if (existingPr) {
    await ghApi(`/repos/${owner}/${repo}/pulls/${existingPr.number}`, token, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    return {
      repo: fullName,
      status: "updated",
      detail: `Updated open PR #${existingPr.number} on \`${branch}\`.`,
    };
  }

  const pr = /** @type {{ html_url: string, number: number }} */ (
    await ghApi(`/repos/${owner}/${repo}/pulls`, token, {
      method: "POST",
      body: JSON.stringify({
        title: bumpPullRequestTitle(tag),
        head: branch,
        base: defaultBranch,
        body,
      }),
    })
  );
  return {
    repo: fullName,
    status: "opened",
    detail: `Opened PR #${pr.number}: ${pr.html_url}`,
  };
}

async function main() {
  const tag = process.env.REVIEW_KIT_TAG;
  const sha = process.env.REVIEW_KIT_SHA;
  const kitToken = process.env.GITHUB_TOKEN;
  const token10xerp = process.env.REVIEW_KIT_BUMP_TOKEN_10XERP || null;
  const tokenBd28 = process.env.REVIEW_KIT_BUMP_TOKEN_BD28 || null;

  if (!tag || !sha || !kitToken) {
    console.error("REVIEW_KIT_TAG, REVIEW_KIT_SHA, and GITHUB_TOKEN are required.");
    process.exit(1);
  }

  const consumersPath =
    process.env.REVIEW_KIT_CONSUMERS_FILE ??
    join(ROOT, "release/consumers.txt");
  const consumers = parseConsumers(readFileSync(consumersPath, "utf8"));

  /** @type {{ repo: string, status: string, detail: string }[]} */
  const results = [];
  let failures = 0;

  for (const consumer of consumers) {
    const ownerToken = consumer.owner === "bd28" ? tokenBd28 : token10xerp;
    try {
      const result = await bumpConsumerRepo(consumer, {
        tag,
        sha,
        kitToken,
        ownerToken,
      });
      results.push(result);
      if (result.status === "failed") failures += 1;
      console.log(`${result.repo}: ${result.status} — ${result.detail}`);
    } catch (err) {
      failures += 1;
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ repo: consumer.fullName, status: "failed", detail });
      console.error(`${consumer.fullName}: failed — ${detail}`);
    }
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [
      "## review-kit consumer bump",
      "",
      `Release **${tag}** (\`${sha}\`)`,
      "",
      "| Repository | Status | Detail |",
      "| --- | --- | --- |",
    ];
    for (const r of results) {
      lines.push(`| ${r.repo} | ${r.status} | ${r.detail.replace(/\|/g, "\\|")} |`);
    }
    const { appendFileSync } = await import("node:fs");
    appendFileSync(summaryPath, `${lines.join("\n")}\n`);
  }

  if (failures > 0) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
