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
