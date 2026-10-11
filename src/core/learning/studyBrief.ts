export function isStudyBriefFrontmatter(frontmatter: Record<string, unknown> | null | undefined): boolean {
  if (!frontmatter) return false;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
  return tags.includes('StudyBrief') || tags.includes('#StudyBrief')
    || typeof frontmatter.study_folder === 'string';
}
