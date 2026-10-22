import { extractOpenFindingsForPrompt } from "./findings.mjs";

/** Open Must Fix findings from the previous review, each followed by the replies it received. */
export function openFindingsWithReplies(priorBody, replies) {
  return extractOpenFindingsForPrompt(priorBody)
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const id = line.match(/^- \[(F\d+)\]/)?.[1];
      const answers = replies
        .filter((r) => r.finding_id === id)
        .map((r) => `  - @${r.author} replied /${r.reply}${r.reason ? `: ${r.reason}` : ""}`);
      return [line, ...answers];
    })
    .join("\n");
}

export function buildPrompt({ repo, pr, headSha, baseRef, mode, diffInstruction, lastSha, openFindings, standards }) {
  const open = openFindings?.trim() ?? "";
  const carryRules =
    "Every prior open Must Fix below stays open, and keeps the PR Blocked, until you close it: write `Fixed: F#` after checking the fix landed, or `Dismissed: F#` when a /fp or /wontfix reply convinces you. Re-list a still-open one under Issues only to update its wording; leaving it out does not close it. Do not repeat Suggestions from the prior review.";
  const priorFindingsBlock = open
    ? `${mode === "incremental" ? `This is an incremental re-review since ${lastSha}. ` : ""}${carryRules} Prior open findings:\n${open}`
    : "";
  // Each review round costs a push, CI and another review, so the full pass reports everything and
  // later passes judge only what the new commits changed.
  const scopeRule =
    mode === "incremental"
      ? `Judge only what changed since ${lastSha}. Raise an Issue or Suggestion only for a defect these commits introduced, including a fix that is wrong or incomplete. Code that was already in the PR at ${lastSha} had its full review: do not raise new findings on it. Changes that arrived by merging the PR base are not this PR's; skip them. Suggestions in this mode are only \`[security]\`, \`[correctness]\` or \`[data-loss]\`: skip convention, maintainability, wording and comment notes, and anything no current caller can reach.`
      : "This is the one full pass on this PR. Report every Must Fix and Suggestion you find now: later pushes get only an incremental review of what changed, and a finding held back costs the author another round.";
  return [
    `REPO: ${repo}`,
    `PR NUMBER: ${pr}`,
    `HEAD SHA: ${headSha}`,
    `REVIEW MODE: ${mode}`,
    "",
    "Review this PR using the review-standards skill below. Apply its criteria and output format exactly.",
    "Skip the self-review loop. Do not run pnpm, npm, vitest, installs, builds, or CI commands; CI already does that.",
    "",
    `Start from \`${diffInstruction}\` (PR base \`${baseRef}\`). Read every file touched in that diff in full (not only hunks). Use Grep for callers of changed public APIs.`,
    "",
    scopeRule,
    "",
    priorFindingsBlock,
    "",
    "Post the review as the sticky PR comment (update in place). First line must be exactly one of:",
    "`# Review: Approved`, `# Review: Approve with notes`, or `# Review: Blocked`.",
    "",
    "<review_standards>",
    standards.trimEnd(),
    "</review_standards>",
    "",
  ].join("\n");
}
