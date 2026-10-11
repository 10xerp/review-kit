export const REVIEW_BOT = "claude[bot]";

const MARKERS = ["# Review:", "Merge Decision:", "claude-review:v1"];
const META_START = "<!-- claude-review:v1";
const META_END = "-->";
const REPLY = /^\/(fp|nit|wontfix)\s+(F\d+)\b[ \t]*([\s\S]*)$/i;
const WORKING = /Claude Code is working[….]{1,3}/g;

/** Latest review comment by the Claude app, optionally only one updated since `since` (ISO time). */
export function findReviewComment(comments, since = "") {
  const matches = comments.filter(
    (c) =>
      c?.user?.login === REVIEW_BOT &&
      MARKERS.some((m) => String(c.body ?? "").includes(m)) &&
      String(c.updated_at ?? "") >= since,
  );
  matches.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
  return matches.at(-1) ?? null;
}

export function readMeta(body) {
  const start = body.indexOf(META_START);
  if (start < 0) return {};
  const end = body.indexOf(META_END, start);
  const meta = {};
  for (const line of body.slice(start, end < 0 ? undefined : end).split("\n")) {
    const m = line.match(/^([a-z_]+)=(.*)$/);
    if (m && !(m[1] in meta)) meta[m[1]] = m[2];
  }
  return meta;
}

export function stripMeta(body) {
  const start = body.indexOf(META_START);
  if (start < 0) return body.trimEnd();
  return body.slice(0, start).trimEnd();
}

/** `extra` adds further `key=value` lines, such as `max_id` (highest finding ID used on the PR). */
export function stampMeta(body, headSha, runId, verdict, extra = {}) {
  const clean = stripMeta(body);
  const more = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}\n`)
    .join("");
  return `${clean}\n\n${META_START}\nlast_sha=${headSha}\nrun_id=${runId}\nverdict=${verdict}\n${more}${META_END}\n`;
}

export function stripWorking(body) {
  return body.replace(WORKING, "");
}

/** `/fp F2 reason`, `/nit F3` and `/wontfix F1 reason` replies from anyone but the review bot. */
export function parseReplies(comments) {
  const replies = [];
  for (const comment of comments) {
    if (comment?.user?.login === REVIEW_BOT) continue;
    const match = String(comment?.body ?? "").trim().match(REPLY);
    if (!match) continue;
    replies.push({
      finding_id: match[2].toUpperCase(),
      reply: match[1].toLowerCase(),
      reason: match[3].trim().slice(0, 500),
      author: comment.user?.login ?? "",
      comment_id: comment.id,
      created_at: comment.created_at ?? "",
    });
  }
  return replies;
}
