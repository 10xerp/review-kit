/**
 * @param {object} input
 * @returns {object}
 */
export function buildReviewRecord(input) {
  const now = new Date().toISOString();
  return {
    schema: "review-kit-record-v1",
    created_at: now,
    review_id: input.review_id,
    repository: input.repository,
    pr_number: input.pr_number,
    head_sha: input.head_sha,
    base_sha: input.base_sha ?? null,
    incremental_from_sha: input.incremental_from_sha ?? null,
    verdict: input.verdict,
    findings: input.findings ?? [],
    usage: {
      model: input.model ?? null,
      model_time_ms: input.model_time_ms ?? null,
      turns: input.turns ?? null,
      cost_usd: input.cost_usd ?? null,
    },
    phases_ms: input.phases_ms ?? {},
    finding_replies: input.finding_replies ?? [],
  };
}

/**
 * Merge /fp /nit /wontfix replies into findings on the record.
 * @param {Array<{ id: string, reply?: string, dismissed?: boolean }>} findings
 * @param {Array<{ findingId: string, reply: string }>} replies
 */
export function applyFindingReplies(findings, replies) {
  const byId = new Map(findings.map((f) => [f.id, { ...f }]));
  for (const r of replies) {
    const row = byId.get(r.findingId);
    if (!row) continue;
    row.reply = r.reply;
    if (r.reply === "fp" || r.reply === "wontfix") {
      row.dismissed = true;
    }
  }
  return [...byId.values()];
}
