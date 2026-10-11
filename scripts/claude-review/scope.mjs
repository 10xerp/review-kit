const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

function isImage(path) {
  return IMAGE_RE.test(path);
}

/**
 * Docs and images need no review unless the consumer opts in with review_docs (markdown and docs/
 * paths are then reviewed; image-only PRs still skip). A PR that edits the workflow running this
 * review is not reviewed by it, since that run would use the PR's own copy of the workflow.
 */
export function reviewScope(files, workflowPath, { reviewDocs = false } = {}) {
  let hasReviewable = false;
  let changesReviewTooling = false;
  let sawImage = false;
  let sawNonImage = false;

  for (const f of files) {
    if (!f) continue;
    if (f === workflowPath) {
      changesReviewTooling = true;
      continue;
    }
    if (reviewDocs) {
      if (isImage(f)) {
        sawImage = true;
        continue;
      }
      sawNonImage = true;
      hasReviewable = true;
      continue;
    }
    if (f.endsWith(".md") || f.startsWith("docs/") || /\.(png|jpg|gif)$/i.test(f)) continue;
    hasReviewable = true;
    sawNonImage = true;
  }

  const review = !changesReviewTooling && hasReviewable;
  const imagesOnlySkip = !review && !changesReviewTooling && sawImage && !sawNonImage;
  return { review, changes_review_tooling: changesReviewTooling, images_only_skip: imagesOnlySkip };
}
