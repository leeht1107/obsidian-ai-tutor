/**
 * Vault-folder matching for the @-mention dropdown.
 *
 * Folders appear alongside files by default so a student finds them without
 * being told the feature exists. A leading `/` narrows the list to folders
 * only, which is what saves you when a folder and a note share a name.
 *
 * Kept pure so the matching rules can be pinned without a vault.
 */

export interface FolderQuery {
  /** The text to match folders against, with any leading `/` removed. */
  text: string;
  /** True when the student asked for folders only by starting with `/`. */
  foldersOnly: boolean;
}

/** Splits the raw mention query into a folder filter and its mode. */
export function parseFolderQuery(rawQuery: string): FolderQuery {
  if (rawQuery.startsWith('/')) {
    return { text: rawQuery.slice(1).toLowerCase(), foldersOnly: true };
  }
  return { text: rawQuery.toLowerCase(), foldersOnly: false };
}

/**
 * Folders whose path or trailing name contains the query, nearest name matches
 * first so typing a folder's own name does not rank its parent above it.
 */
export function filterVaultFolders(
  folderPaths: readonly string[],
  query: string,
  limit: number
): string[] {
  if (limit <= 0) return [];
  const needle = query.toLowerCase();

  return folderPaths
    .filter((path) => {
      const lower = path.toLowerCase();
      return lower.includes(needle) || folderNameOf(lower).includes(needle);
    })
    .sort((a, b) => {
      const aStarts = folderNameOf(a.toLowerCase()).startsWith(needle);
      const bStarts = folderNameOf(b.toLowerCase()).startsWith(needle);
      if (aStarts !== bStarts) return aStarts ? -1 : 1;
      // Shallower folders are the more useful answer at equal relevance.
      const depth = a.split('/').length - b.split('/').length;
      return depth !== 0 ? depth : a.localeCompare(b);
    })
    .slice(0, limit);
}

function folderNameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? path : path.slice(cut + 1);
}
