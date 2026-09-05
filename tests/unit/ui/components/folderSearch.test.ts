import { filterVaultFolders, parseFolderQuery } from '@/ui/components/file-context/mention/folderSearch';

const FOLDERS = [
  '01. Projects',
  '01. Projects/DB_26',
  '01. Projects/DB_26/notes',
  '02. Areas',
  '02. Areas/database',
  'Archive',
];

describe('mention folder search', () => {
  it('treats a leading slash as folders-only, and strips it from the query', () => {
    expect(parseFolderQuery('/db')).toEqual({ text: 'db', foldersOnly: true });
  });

  it('leaves an ordinary query in mixed mode', () => {
    expect(parseFolderQuery('db')).toEqual({ text: 'db', foldersOnly: false });
  });

  it('treats a bare slash as folders-only with no filter, listing everything', () => {
    const parsed = parseFolderQuery('/');
    expect(parsed).toEqual({ text: '', foldersOnly: true });
    expect(filterVaultFolders(FOLDERS, parsed.text, 10)).toHaveLength(FOLDERS.length);
  });

  it('ranks a folder whose own name matches above its parent', () => {
    // Typing "DB" should not put "01. Projects" first just because the path contains it.
    expect(filterVaultFolders(FOLDERS, 'db', 10)[0]).toBe('01. Projects/DB_26');
  });

  it('matches on any part of the path, not just the name', () => {
    expect(filterVaultFolders(FOLDERS, 'projects', 10)).toContain('01. Projects/DB_26/notes');
  });

  it('is case-insensitive', () => {
    expect(filterVaultFolders(FOLDERS, 'DATABASE', 10)).toEqual(['02. Areas/database']);
  });

  it('prefers the shallower folder when relevance ties', () => {
    const hits = filterVaultFolders(['a/b/deep', 'a', 'a/b'], '', 10);
    expect(hits).toEqual(['a', 'a/b', 'a/b/deep']);
  });

  it('respects the remaining slot count', () => {
    expect(filterVaultFolders(FOLDERS, '', 2)).toHaveLength(2);
    expect(filterVaultFolders(FOLDERS, '', 0)).toEqual([]);
  });
});
