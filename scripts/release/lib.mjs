/** @typedef {{ owner: string, repo: string, fullName: string }} ConsumerRepo */

const USES_LINE =
  /^(\s*-\s*uses:\s*10xerp\/review-kit@)([0-9a-f]{40})(\s*(#\s*v[^\s#]+)?)?\s*$/i;

/**
 * @param {string} text
 * @returns {ConsumerRepo[]}
 */
export function parseConsumers(text) {
  /** @type {ConsumerRepo[]} */
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const slash = line.indexOf("/");
    if (slash <= 0 || slash === line.length - 1) {
      throw new Error(`Invalid consumer line: ${raw}`);
    }
    const owner = line.slice(0, slash);
    const repo = line.slice(slash + 1);
    out.push({ owner, repo, fullName: line });
  }
  return out;
}

/**
 * @param {string} content
 * @returns {string | null}
 */
export function findPinnedSha(content) {
  for (const line of content.split("\n")) {
    const m = line.match(USES_LINE);
    if (m) return m[2].toLowerCase();
  }
  return null;
}

/**
 * @param {string} content
 * @param {string} sha 40-char commit SHA
 * @param {string} tag e.g. v4
 * @returns {{ content: string, changed: boolean, previousSha: string | null }}
 */
export function rewriteReviewKitUses(content, sha, tag) {
  const normalizedSha = sha.toLowerCase();
  const comment = ` # ${tag}`;
  let changed = false;
  /** @type {string | null} */
  let previousSha = null;
  const lines = content.split("\n");
  const next = lines.map((line) => {
    const m = line.match(USES_LINE);
    if (!m) return line;
    if (previousSha === null) previousSha = m[2].toLowerCase();
    if (m[2].toLowerCase() === normalizedSha && m[3]?.trim() === comment.trim()) {
      return line;
    }
    changed = true;
    return `${m[1]}${normalizedSha}${comment}`;
  });
  return { content: next.join("\n"), changed, previousSha };
}

/**
 * @param {string} workflowDirListing
 * @param {(path: string) => Promise<string | null>} readFile
 * @param {string} targetSha
 * @param {string} tag
 */
export async function collectWorkflowUpdates(workflowDirListing, readFile, targetSha, tag) {
  /** @type {{ path: string, content: string, previousSha: string | null }[]} */
  const updates = [];
  for (const entry of workflowDirListing) {
    if (entry.type !== "file" || !/\.(ya?ml)$/i.test(entry.name)) continue;
    const path = `.github/workflows/${entry.name}`;
    const raw = await readFile(path);
    if (raw === null) continue;
    const { content, changed, previousSha } = rewriteReviewKitUses(raw, targetSha, tag);
    if (changed) updates.push({ path, content, previousSha });
  }
  return updates;
}

export function bumpPullRequestTitle(tag) {
  return `Bump review-kit to ${tag}`;
}

export function bumpBranchName(tag) {
  return `review-kit/bump-${tag}`;
}
