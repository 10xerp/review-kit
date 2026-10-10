export const HEADINGS = {
  approved: "# Review: Approved",
  approve_with_notes: "# Review: Approve with notes",
  blocked: "# Review: Blocked",
};

export function parseVerdictLine(body) {
  const lines = body.split("\n");
  let first = lines.find((l) => l.startsWith("# Review: ")) ?? "";
  if (!first) first = lines.find((l) => l.includes("Merge Decision:")) ?? "";
  if (first.includes("Blocked") || first.includes("Merge Decision: NO")) return "blocked";
  if (first.includes("Approve with notes") || first.includes("YES (Approve with notes)")) {
    return "approve_with_notes";
  }
  if (first.includes("Approved") || first.includes("Merge Decision: YES")) return "approved";
  return "";
}

export function verdictSummary(verdict) {
  switch (verdict) {
    case "blocked":
      return "Blocked (must fix Issues)";
    case "approve_with_notes":
      return "Approve with notes";
    case "approved":
      return "Approved";
    default:
      return verdict;
  }
}

/** Any line listed under Issues counts, even one that does not match the finding format. */
export function hasMustFix(body) {
  let inIssues = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      inIssues = line.startsWith("## Issues (Must Fix)");
      continue;
    }
    if (inIssues && line.startsWith("- ")) return true;
  }
  return false;
}

/**
 * The single verdict for a review: Blocked whenever a Must Fix is listed. The heading is rewritten
 * to match, so the comment, its metadata and the check can never disagree.
 */
export function resolveReview(body, verdict) {
  const resolved = verdict && hasMustFix(body) ? "blocked" : verdict;
  if (!resolved || parseVerdictLine(body) === resolved) return { body, verdict: resolved };
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.startsWith("# Review: "));
  if (index >= 0) lines[index] = HEADINGS[resolved];
  else lines.unshift(HEADINGS[resolved], "");
  return { body: lines.join("\n"), verdict: resolved };
}
