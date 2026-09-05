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

describe('folder ranking around the current note', () => {
  const { rankFoldersByProximity } = jest.requireActual(
    '@/ui/components/file-context/mention/folderSearch'
  );

  const VAULT = [
    '01. Projects',
    '01. Projects/DB_26',
    '01. Projects/DB_26/week01',
    '01. Projects/DB_26/week02',
    '01. Projects/ML_26',
    '02. Areas',
    'Archive',
  ];

  it('puts the folder the note lives in first', () => {
    const ranked = rankFoldersByProximity(VAULT, '01. Projects/DB_26', '', 10);
    expect(ranked[0]).toBe('01. Projects/DB_26');
  });

  it('puts the note’s own subfolders next, before unrelated branches', () => {
    const ranked = rankFoldersByProximity(VAULT, '01. Projects/DB_26', '', 10);
    expect(ranked.slice(1, 3).sort()).toEqual(['01. Projects/DB_26/week01', '01. Projects/DB_26/week02']);
    expect(ranked.indexOf('Archive')).toBeGreaterThan(ranked.indexOf('01. Projects/ML_26'));
  });

  it('ranks a sibling above a stranger', () => {
    const ranked = rankFoldersByProximity(VAULT, '01. Projects/DB_26', '', 10);
    expect(ranked.indexOf('01. Projects/ML_26')).toBeLessThan(ranked.indexOf('02. Areas'));
  });

  it('still honours the typed filter while ranking', () => {
    const ranked = rankFoldersByProximity(VAULT, '01. Projects/DB_26', 'week', 10);
    expect(ranked).toEqual(['01. Projects/DB_26/week01', '01. Projects/DB_26/week02']);
  });

  it('falls back to a plain ordering when no note is open', () => {
    const ranked = rankFoldersByProximity(VAULT, null, '', 3);
    expect(ranked).toEqual(['01. Projects', '02. Areas', 'Archive']);
  });

  it('respects the limit', () => {
    expect(rankFoldersByProximity(VAULT, '01. Projects/DB_26', '', 2)).toHaveLength(2);
  });
});
