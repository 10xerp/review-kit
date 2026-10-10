/** @typedef {'approve' | 'approve_with_notes' | 'blocked'} ReviewVerdict */

export const META_START = "<!-- review-kit-meta";
export const META_END = "-->";

/** @type {Record<ReviewVerdict, string>} */
export const VERDICT_HEADINGS = {
  approve: "Review: Approved",
  approve_with_notes: "Review: Approved with notes",
  blocked: "Review: Blocked",
};

/** @param {unknown} value @returns {value is ReviewVerdict} */
export function isReviewVerdict(value) {
  return (
    value === "approve" ||
    value === "approve_with_notes" ||
    value === "blocked"
  );
}

/**
 * Parse the hidden HTML meta block (single source of truth).
 * @param {string} body
 * @returns {{ verdict: ReviewVerdict | null, meta: Record<string, unknown> | null, raw: string | null }}
 */
export function parseReviewMeta(body) {
  if (!body || typeof body !== "string") {
    return { verdict: null, meta: null, raw: null };
  }

  const re = /<!--\s*review-kit-meta\s+([\s\S]*?)\s*-->/i;
  const match = body.match(re);
  if (!match) {
    return { verdict: null, meta: null, raw: null };
  }

  const raw = match[1].trim();
  /** @type {Record<string, unknown>} */
  let meta = {};
  try {
    meta = JSON.parse(raw);
  } catch {
    const verdictMatch = raw.match(/verdict=([a-z_]+)/i);
    if (verdictMatch && isReviewVerdict(verdictMatch[1])) {
      meta = { verdict: verdictMatch[1] };
    } else {
      return { verdict: null, meta: null, raw };
    }
  }

  const verdictRaw = meta.verdict;
  const verdict = isReviewVerdict(verdictRaw) ? verdictRaw : null;
  return { verdict, meta, raw };
}

/**
 * @param {Array<{ severity?: string, dismissed?: boolean, reply?: string }>} findings
 */
export function hasOpenMustFix(findings) {
  if (!Array.isArray(findings)) return false;
  return findings.some((f) => {
    if (!f || f.severity !== "must_fix") return false;
    if (f.dismissed) return false;
    const reply = typeof f.reply === "string" ? f.reply.toLowerCase() : "";
    if (reply === "fp" || reply === "wontfix") return false;
    return true;
  });
}

/**
 * GitHub check / job should fail when review is blocked or must-fix items remain open.
 * @param {ReviewVerdict | null} verdict
 * @param {Array<{ severity?: string, dismissed?: boolean, reply?: string }>} [findings]
 */
export function reviewGateFails(verdict, findings = []) {
  if (verdict === "blocked") return true;
  if (hasOpenMustFix(findings)) return true;
  return false;
}

/**
 * Build sticky comment body with heading derived from the same verdict as meta.
 * @param {ReviewVerdict} verdict
 * @param {string} summaryMarkdown
 * @param {Record<string, unknown>} extraMeta
 */
export function formatStickyComment(verdict, summaryMarkdown, extraMeta = {}) {
  const heading = VERDICT_HEADINGS[verdict];
  const meta = {
    version: 1,
    verdict,
    ...extraMeta,
  };
  const metaJson = JSON.stringify(meta);
  return `${META_START} ${metaJson} ${META_END}

# ${heading}

${summaryMarkdown.trim()}
`;
}

/**
 * Detect user replies on finding IDs (/fp, /nit, /wontfix).
 * @param {string} commentBody
 * @returns {{ findingId: string, reply: 'fp' | 'nit' | 'wontfix' } | null}
 */
export function parseFindingReply(commentBody) {
  if (!commentBody) return null;
  const m = commentBody
    .trim()
    .match(/^\/(fp|nit|wontfix)\s+([A-Za-z0-9_-]+)\b/i);
  if (!m) return null;
  return { reply: /** @type {'fp'|'nit'|'wontfix'} */ (m[1].toLowerCase()), findingId: m[2] };
}
