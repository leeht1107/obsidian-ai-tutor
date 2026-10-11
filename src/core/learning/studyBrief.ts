/** Learning scope used when no course note survived evidence filtering but a Brief goal was prepared. */
export const PREPARED_EVIDENCE_ONLY = 'No selected course notes. Use prepared concept evidence only.';

export function isStudyBriefFrontmatter(frontmatter: Record<string, unknown> | null | undefined): boolean {
  if (!frontmatter) return false;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
  return tags.includes('StudyBrief') || tags.includes('#StudyBrief')
    || typeof frontmatter.study_folder === 'string';
}
