import {
  collectFolderFiles,
  parseGitHubFolderUrl,
  type RemoteEntry,
  resolveSkillFilePath,
} from '../../../../src/features/skills/ObsidianSkillsInstaller';

describe('parseGitHubFolderUrl', () => {
  it('reads owner, repo, ref and directory out of a tree URL', () => {
    expect(parseGitHubFolderUrl('https://github.com/anthropics/skills/tree/main/skills/docx')).toEqual({
      owner: 'anthropics',
      repo: 'skills',
      ref: 'main',
      dir: 'skills/docx',
    });
  });

  it('tolerates a trailing slash', () => {
    expect(parseGitHubFolderUrl('https://github.com/anthropics/skills/tree/main/skills/pptx/')?.dir)
      .toBe('skills/pptx');
  });

  it('returns null for URLs that already name a single file', () => {
    expect(parseGitHubFolderUrl('https://github.com/a/b/blob/main/SKILL.md')).toBeNull();
    expect(parseGitHubFolderUrl('https://github.com/a/b/tree/main/docs/SKILL.md')).toBeNull();
    expect(parseGitHubFolderUrl('https://github.com/a/b')).toBeNull();
    expect(parseGitHubFolderUrl('https://example.com/a/b/tree/main/x')).toBeNull();
  });

  it('still treats a folder whose name contains a dot as a folder', () => {
    // "any extension" sent these down the one-file path and silently dropped
    // the scripts the skill needs.
    expect(parseGitHubFolderUrl('https://github.com/a/b/tree/main/skills/docx.v2')?.dir)
      .toBe('skills/docx.v2');
    expect(parseGitHubFolderUrl('https://github.com/a/b/tree/main/skills/v1.2')?.dir)
      .toBe('skills/v1.2');
  });
});

describe('collectFolderFiles', () => {
  const ref = { owner: 'anthropics', repo: 'skills', ref: 'main', dir: 'skills/docx' };

  const tree: Record<string, RemoteEntry[]> = {
    'skills/docx': [
      { path: 'skills/docx/SKILL.md', type: 'file', download_url: 'raw/SKILL.md' },
      { path: 'skills/docx/LICENSE.txt', type: 'file', download_url: 'raw/LICENSE.txt' },
      { path: 'skills/docx/scripts', type: 'dir', download_url: null },
    ],
    'skills/docx/scripts': [
      { path: 'skills/docx/scripts/merge_runs.py', type: 'file', download_url: 'raw/merge_runs.py' },
      { path: 'skills/docx/scripts/office', type: 'dir', download_url: null },
    ],
    'skills/docx/scripts/office': [
      { path: 'skills/docx/scripts/office/validate.py', type: 'file', download_url: 'raw/validate.py' },
    ],
  };

  const listDir = async (dir: string): Promise<RemoteEntry[]> => tree[dir] ?? [];

  it('walks subdirectories and returns paths relative to the skill folder', async () => {
    const files = await collectFolderFiles(ref, listDir);
    expect(files.map((file) => file.relativePath).sort()).toEqual([
      'LICENSE.txt',
      'SKILL.md',
      'scripts/merge_runs.py',
      'scripts/office/validate.py',
    ]);
    expect(files.find((file) => file.relativePath === 'SKILL.md')?.downloadUrl).toBe('raw/SKILL.md');
  });

  it('refuses a folder with no SKILL.md rather than installing a skill the CLI cannot read', async () => {
    await expect(collectFolderFiles({ ...ref, dir: 'skills/docx/scripts' }, listDir))
      .rejects.toThrow(/SKILL\.md/);
  });

  it('stops before downloading an unbounded tree', async () => {
    const many: RemoteEntry[] = [
      { path: 'big/SKILL.md', type: 'file', download_url: 'raw/SKILL.md' },
      ...Array.from({ length: 80 }, (_unused, index) => ({
        path: `big/file-${index}.py`,
        type: 'file' as const,
        download_url: `raw/file-${index}.py`,
      })),
    ];
    await expect(collectFolderFiles({ ...ref, dir: 'big' }, async () => many))
      .rejects.toThrow(/too many files/i);
  });
});

describe('collectFolderFiles — refusing what would escape the skill folder', () => {
  const ref = { owner: 'a', repo: 'b', ref: 'main', dir: 'skills/x' };
  const listing = (...entries: RemoteEntry[]) => async () => entries;

  const skillMd: RemoteEntry = {
    path: 'skills/x/SKILL.md', type: 'file', download_url: 'raw/SKILL.md', size: 10,
  };

  it('refuses a backslash path instead of skipping it', async () => {
    // path.join treats a backslash as a separator on Windows, so a guard that
    // only splits on "/" lets `sub\..\..\evil` out of the skill folder.
    await expect(collectFolderFiles(ref, listing(
      skillMd,
      { path: 'skills/x/sub\\..\\..\\evil.py', type: 'file', download_url: 'raw/evil', size: 10 },
    ))).rejects.toThrow(/unsafe path/i);
  });

  it('refuses an absolute or parent-relative path', async () => {
    await expect(collectFolderFiles(ref, listing(
      skillMd,
      { path: 'skills/x/../escaped.py', type: 'file', download_url: 'raw/escaped', size: 10 },
    ))).rejects.toThrow(/unsafe path/i);
    await expect(collectFolderFiles(ref, listing(
      skillMd,
      { path: 'skills/x//abs.py', type: 'file', download_url: 'raw/abs', size: 10 },
    ))).rejects.toThrow(/unsafe path/i);
  });

  it('refuses a folder whose files add up past the byte ceiling', async () => {
    await expect(collectFolderFiles(ref, listing(
      skillMd,
      { path: 'skills/x/huge.bin', type: 'file', download_url: 'raw/huge', size: 99_000_000 },
    ))).rejects.toThrow(/too large/i);
  });

  it('stops walking after too many subdirectories', async () => {
    // A folder that keeps pointing at a fresh subdirectory would otherwise burn
    // the 60-per-hour unauthenticated GitHub allowance one listing at a time.
    let depth = 0;
    const endless = async (): Promise<RemoteEntry[]> => [
      { path: `skills/x/deep-${depth++}`, type: 'dir', download_url: null },
    ];
    await expect(collectFolderFiles(ref, endless)).rejects.toThrow(/too many folders/i);
  });
});

describe('resolveSkillFilePath', () => {
  it('keeps a normal nested path inside the skill folder', () => {
    expect(resolveSkillFilePath('/vault/.claude/skills/docx', 'scripts/office/validate.py'))
      .toBe('/vault/.claude/skills/docx/scripts/office/validate.py');
  });

  it('returns null for anything that resolves outside the skill folder', () => {
    expect(resolveSkillFilePath('/vault/.claude/skills/docx', '../../../etc/passwd')).toBeNull();
    expect(resolveSkillFilePath('/vault/.claude/skills/docx', '/etc/passwd')).toBeNull();
    expect(resolveSkillFilePath('/vault/.claude/skills/docx', '')).toBeNull();
  });
});

describe('resolveSkillFilePath — the aliases a fixed-root check used to let through', () => {
  it('refuses a path that walks out and back in under a different root', () => {
    // `../docx/evil.py` from /skills/docx resolves back inside it. It is still a
    // remote path claiming to be somewhere it is not, so it is refused.
    expect(resolveSkillFilePath('/vault/skills/docx', '../docx/evil.py')).toBeNull();
  });

  it('refuses "." and a doubled separator', () => {
    expect(resolveSkillFilePath('/vault/skills/docx', '.')).toBeNull();
    expect(resolveSkillFilePath('/vault/skills/docx', './SKILL.md')).toBeNull();
    expect(resolveSkillFilePath('/vault/skills/docx', 'scripts//x.py')).toBeNull();
  });
});

describe('collectFolderFiles — the listed size is carried to the download loop', () => {
  it('keeps each entry size so an oversized file can be refused before it is buffered', async () => {
    const files = await collectFolderFiles(
      { owner: 'a', repo: 'b', ref: 'main', dir: 'd' },
      async () => [
        { path: 'd/SKILL.md', type: 'file', download_url: 'raw/SKILL.md', size: 120 },
        { path: 'd/big.py', type: 'file', download_url: 'raw/big', size: 4096 },
      ]
    );
    expect(files.map((file) => file.size)).toEqual([120, 4096]);
  });
});
