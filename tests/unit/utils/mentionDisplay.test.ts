import { findMentionRanges, splitMentionPath } from '../../../src/utils/mentionDisplay';

/**
 * Two complaints, both about @-mentions being hard to read:
 *  - the dropdown printed the whole vault path on one ellipsised line, so in a narrow
 *    sidebar the folders won and the filename — the part being searched for — was cut off;
 *  - a sent message showed `@note.md` as ordinary prose, with nothing marking it as context.
 */
describe('showing a vault path in the mention dropdown', () => {
  it('puts the file name first and the folders second', () => {
    expect(splitMentionPath('01. Projects/lecture-financial/Week01/FD-01-600.md'))
      .toEqual({ name: 'FD-01-600.md', folder: '01. Projects/lecture-financial/Week01' });
  });

  it('leaves a root-level file without a folder line', () => {
    expect(splitMentionPath('README.md')).toEqual({ name: 'README.md', folder: '' });
  });

  it('handles a trailing slash and backslashes', () => {
    expect(splitMentionPath('notes/Week01/')).toEqual({ name: 'Week01', folder: 'notes' });
    expect(splitMentionPath('notes\\Week01\\a.md')).toEqual({ name: 'a.md', folder: 'notes/Week01' });
  });

  it('survives an empty or whitespace path', () => {
    expect(splitMentionPath('')).toEqual({ name: '', folder: '' });
    expect(splitMentionPath('   ')).toEqual({ name: '', folder: '' });
  });
});

describe('marking @-mentions inside a sent message', () => {
  const found = (text: string) => findMentionRanges(text).map((r) => text.slice(r.start, r.end));

  it('finds a plain file mention', () => {
    expect(found('이 @note.md 정리해줘')).toEqual(['@note.md']);
  });

  it('finds a path mention and a quoted one', () => {
    expect(found('@lecture/Week01/a.md 봐줘')).toEqual(['@lecture/Week01/a.md']);
    expect(found('@"내 노트 1.md" 봐줘')).toEqual(['@"내 노트 1.md"']);
  });

  it('finds several in one message', () => {
    expect(found('@a.md 와 @b/c.md 비교')).toEqual(['@a.md', '@b/c.md']);
  });

  it('ignores an email address, which is not a mention', () => {
    expect(found('leeht1107@gmail.com 로 보내줘')).toEqual([]);
  });

  it('ignores a bare @ and @word with no extension', () => {
    expect(found('@ 그리고 @something 은 파일이 아님')).toEqual([]);
  });

  it('returns ranges in order and never overlapping', () => {
    const text = '@a.md @b.md @c.md';
    const ranges = findMentionRanges(text);
    expect(ranges).toHaveLength(3);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].start).toBeGreaterThanOrEqual(ranges[i - 1].end);
    }
  });

  it('finds nothing in text with no mention', () => {
    expect(found('그냥 평범한 문장입니다')).toEqual([]);
  });
});

describe('folder label for a deep path', () => {
  it('keeps the folder nearest the file, which is the one that identifies it', () => {
    const { formatMentionFolder } = jest.requireActual('@/utils/mentionDisplay');
    // CSS ellipsis cuts the tail, so a long path lost `program` — the only part
    // that says which folder this actually is — and kept `01. Projects`.
    expect(formatMentionFolder('01. Projects/연구_response_of_macro/program'))
      .toBe('…/연구_response_of_macro/program');
  });

  it('leaves a short path exactly as it is', () => {
    const { formatMentionFolder } = jest.requireActual('@/utils/mentionDisplay');
    expect(formatMentionFolder('Notes/2026')).toBe('Notes/2026');
    expect(formatMentionFolder('Notes')).toBe('Notes');
    expect(formatMentionFolder('')).toBe('');
  });
});

describe('input highlight segments', () => {
  const { buildMentionSegments } = jest.requireActual('@/utils/mentionDisplay');

  it('splits typed text into plain and mention runs', () => {
    expect(buildMentionSegments('보고 @Week01.md 정리해줘')).toEqual([
      { text: '보고 ', isMention: false },
      { text: '@Week01.md', isMention: true },
      { text: ' 정리해줘', isMention: false },
    ]);
  });

  it('marks several mentions in one line', () => {
    const segments = buildMentionSegments('@Week01_notes_compiled.md  @BOARD.md');
    expect(segments.filter((s: any) => s.isMention).map((s: any) => s.text))
      .toEqual(['@Week01_notes_compiled.md', '@BOARD.md']);
  });

  it('returns a single plain run when nothing was mentioned', () => {
    expect(buildMentionSegments('그냥 질문입니다')).toEqual([
      { text: '그냥 질문입니다', isMention: false },
    ]);
  });

  it('does not mistake an email address for a mention', () => {
    const segments = buildMentionSegments('mark@example.com 으로 보내줘');
    expect(segments.some((s: any) => s.isMention)).toBe(false);
  });

  it('keeps the text recoverable exactly, so the overlay cannot drift', () => {
    const raw = '앞 @a.md 사이 @b.md 뒤';
    expect(buildMentionSegments(raw).map((s: any) => s.text).join('')).toBe(raw);
  });

  it('has no segments for empty input', () => {
    expect(buildMentionSegments('')).toEqual([]);
  });
});

describe('folder labels that actually distinguish the rows', () => {
  const { disambiguateFolderLabels } = jest.requireActual('@/utils/mentionDisplay');

  // Six lecture projects in the real vault all end in lecture/WeekNN/notes.
  const LECTURES = [
    '01. Projects/lecture-financial-data-analysis/lecture/Week01/notes',
    '01. Projects/lecture-data-mining-analysis/lecture/Week01/notes',
    '01. Projects/lecture-database-systems/lecture/Week01/notes',
  ];

  it('keeps going up until the rows stop looking identical', () => {
    const labels = disambiguateFolderLabels(LECTURES);
    expect(labels.get(LECTURES[0])).toBe('…/lecture-financial-data-analysis/lecture/Week01');
    expect(new Set([...labels.values()]).size).toBe(3);
  });

  it('stays short when the nearest folder is already enough', () => {
    const labels = disambiguateFolderLabels(['Notes/2026/a', 'Archive/2025/b']);
    expect(labels.get('Notes/2026/a')).toBe('…/2026');
    expect(labels.get('Archive/2025/b')).toBe('…/2025');
  });

  it('drops the ellipsis when the whole path is shown', () => {
    const labels = disambiguateFolderLabels(['Notes/a', 'Archive/b']);
    expect(labels.get('Notes/a')).toBe('Notes');
  });

  it('gives a top-level folder an empty label rather than a stray ellipsis', () => {
    expect(disambiguateFolderLabels(['Archive']).get('Archive')).toBe('');
  });

  it('handles a single row without inventing context', () => {
    expect(disambiguateFolderLabels(['a/b/c']).get('a/b/c')).toBe('…/b');
  });

  it('stops expanding at the cap even when rows still collide', () => {
    const deep = ['x1/a/b/c/d/e', 'x2/a/b/c/d/e'];
    const labels = disambiguateFolderLabels(deep, 3);
    // Capped, so both may still read alike — but never longer than the cap.
    expect(labels.get(deep[0])!.split('/').length).toBeLessThanOrEqual(4);
  });
});
