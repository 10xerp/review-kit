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
      ? `This is an incremental re-review since ${lastSha}. Do not repeat findings from the prior review unless they still apply. Acknowledge each fixed Must Fix with a line \`Fixed: F#\` (finding id). Prior open findings:\n${openFindings}`
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
