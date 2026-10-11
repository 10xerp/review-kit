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
  const incremental =
    mode === "incremental"
      ? `This is an incremental re-review since ${lastSha}. Every prior open Must Fix below stays open, and keeps the PR Blocked, until you close it: write \`Fixed: F#\` after checking the fix landed, or \`Dismissed: F#\` when a /fp or /wontfix reply convinces you. Re-list a still-open one under Issues only to update its wording; leaving it out does not close it. Do not repeat Suggestions from the prior review. Prior open findings:\n${openFindings}`
      : "";
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
    incremental,
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
