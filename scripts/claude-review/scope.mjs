/**
 * Docs and images need no review. A PR that edits the workflow running this review is not reviewed
 * by it, since that run would use the PR's own copy of the workflow.
 */
export function reviewScope(files, workflowPath) {
  let hasCode = false;
  let changesReviewTooling = false;
  for (const f of files) {
    if (!f) continue;
    if (f === workflowPath) {
      changesReviewTooling = true;
      continue;
    }
    if (f.endsWith(".md") || f.startsWith("docs/") || /\.(png|jpg|gif)$/.test(f)) continue;
    hasCode = true;
  }
  return { review: !changesReviewTooling && hasCode, changes_review_tooling: changesReviewTooling };
}
