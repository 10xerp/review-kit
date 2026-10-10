/**
 * claude-code-action skips when the workflow file on the PR head is not identical to the one on
 * the base branch, even if this PR did not edit that file.
 */
export function workflowContentsDiffer(headContent, baseContent, { headExists = true, baseExists = true } = {}) {
  if (!headExists && !baseExists) return false;
  if (headExists !== baseExists) return true;
  return headContent !== baseContent;
}
