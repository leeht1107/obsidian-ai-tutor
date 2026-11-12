import {
  applyReviewHunks,
  buildReviewHunks,
  EDIT_PROPOSAL_BEGIN,
  EDIT_PROPOSAL_END,
  extractEditProposal,
  readProposalIntoReview,
  sameNote,
  toEditorChanges,
} from '@/features/edit-review/editReview';

const BASE = [
  '# 경영전략 1주차',
  '',
  '## 핵심 개념',
  '- 경쟁우위: 경쟁사 대비 상대적으로 우월한 가치 창출 역량',
  '',
  '## 약점',
  '- 높은 원가 구조',
  '',
  '## 메모',
  '- 다음 주 발표 준비하기',
  '',
  '## 과제',
  '- 사례 기업 분석하기',
  '',
].join('\n');

// Three separate edits: rewrite line 4, insert after line 7, delete lines 9-11.
const REVISED = [
  '# 경영전략 1주차',
  '',
  '## 핵심 개념',
  '- 경쟁우위: 고객에게 더 큰 가치를 주는 힘',
  '',
  '## 약점',
  '- 높은 원가 구조',
  '- 느린 신제품 출시 속도',
  '',
  '## 과제',
  '- 사례 기업 분석하기',
  '',
].join('\n');

const proposal = (body: string, before = '바꿨어요.', after = '') =>
  `${before}\n${EDIT_PROPOSAL_BEGIN}\n${body}\n${EDIT_PROPOSAL_END}\n${after}`;

describe('extractEditProposal', () => {
  it('returns none for an ordinary answer', () => {
    expect(extractEditProposal('노트를 요약하면 이렇습니다.')).toEqual({ kind: 'none' });
  });

  it('extracts the revised note and keeps the text outside the markers for display', () => {
    const result = extractEditProposal(proposal('# 제목\n본문', '세 군데를 바꿨어요.', '확인해 주세요.'));
    expect(result).toEqual({ kind: 'proposal', revised: '# 제목\n본문', displayText: '세 군데를 바꿨어요.\n\n확인해 주세요.' });
  });

  it('treats a missing end marker or two proposals as malformed', () => {
    expect(extractEditProposal(`${EDIT_PROPOSAL_BEGIN}\n# 제목`).kind).toBe('malformed');
    expect(extractEditProposal(proposal('a') + proposal('b')).kind).toBe('malformed');
    expect(extractEditProposal(`${EDIT_PROPOSAL_END}\n${EDIT_PROPOSAL_BEGIN}\na`).kind).toBe('malformed');
  });
});

describe('buildReviewHunks', () => {
  it('splits separated edits into one hunk each, in original line coordinates', () => {
    const hunks = buildReviewHunks(BASE, REVISED);
    expect(hunks.map((h) => [h.oldStart, h.oldLines, h.newLines])).toEqual([
      [3, ['- 경쟁우위: 경쟁사 대비 상대적으로 우월한 가치 창출 역량'], ['- 경쟁우위: 고객에게 더 큰 가치를 주는 힘']],
      [7, [], ['- 느린 신제품 출시 속도']],
      [8, ['## 메모', '- 다음 주 발표 준비하기', ''], []],
    ]);
  });

  it('returns no hunks when nothing changed', () => {
    expect(buildReviewHunks(BASE, BASE)).toEqual([]);
  });
});

describe('applyReviewHunks', () => {
  const hunks = buildReviewHunks(BASE, REVISED);
  const ids = hunks.map((h) => h.id);

  it('accepting every hunk yields the revised note', () => {
    expect(applyReviewHunks(BASE, hunks, ids)).toBe(REVISED);
  });

  it('accepting none yields the original note byte for byte', () => {
    expect(applyReviewHunks(BASE, hunks, [])).toBe(BASE);
  });

  it('accepting only the middle hunk inserts that line and nothing else', () => {
    const expected = BASE.replace('- 높은 원가 구조\n', '- 높은 원가 구조\n- 느린 신제품 출시 속도\n');
    expect(applyReviewHunks(BASE, hunks, [ids[1]])).toBe(expected);
  });

  it('accepting only the last hunk deletes the memo section and keeps the first line as written', () => {
    const expected = BASE.replace('## 메모\n- 다음 주 발표 준비하기\n\n', '');
    expect(applyReviewHunks(BASE, hunks, [ids[2]])).toBe(expected);
  });

  it('keeps CRLF line endings and the final newline of the original', () => {
    const crlfBase = BASE.replace(/\n/g, '\r\n');
    const crlfHunks = buildReviewHunks(crlfBase, REVISED); // model answers in LF
    expect(applyReviewHunks(crlfBase, crlfHunks, crlfHunks.map((h) => h.id))).toBe(REVISED.replace(/\n/g, '\r\n'));
  });

  it('keeps each unchanged line\'s own ending in a note with mixed line endings', () => {
    const base = 'a\r\nb\nc\n';
    const h = buildReviewHunks(base, 'A\r\nb\nc\n');
    expect(applyReviewHunks(base, h, h.map((x) => x.id))).toBe('A\r\nb\nc\n');
  });

  it('gives an inserted line the ending of the line above it', () => {
    const base = 'a\nb\r\nc\n';
    const h = buildReviewHunks(base, 'a\nb\nX\nc\n');
    expect(applyReviewHunks(base, h, h.map((x) => x.id))).toBe('a\nb\r\nX\r\nc\n');
  });

  it('keeps the own ending of a line that becomes last after the last line is deleted', () => {
    const base = 'a\r\nb\n';
    const h = buildReviewHunks(base, 'a\n');
    expect(applyReviewHunks(base, h, h.map((x) => x.id))).toBe('a\r\n');
  });

  it('gives a new last line the final ending of the note', () => {
    const base = 'a\nb';
    const h = buildReviewHunks(base, 'a\nB');
    expect(applyReviewHunks(base, h, h.map((x) => x.id))).toBe('a\nB');
  });

  it('adds a line after a last line that had no newline without gluing them', () => {
    const base = 'a\nb';
    const h = buildReviewHunks(base, 'a\nb\nc');
    expect(applyReviewHunks(base, h, h.map((x) => x.id))).toBe('a\nb\nc');
  });

  it('keeps a note without a final newline that way', () => {
    const base = 'a\nb\nc';
    const h = buildReviewHunks(base, 'a\nB\nc\n');
    expect(applyReviewHunks(base, h, h.map((x) => x.id))).toBe('a\nB\nc');
  });
});


describe('readProposalIntoReview', () => {
  const awaiting = () => ({ notePath: 'n.md', base: BASE, request: 'r', hunks: [], decisions: {}, status: 'awaiting' as const });

  it('turns a proposal into a pending review and hides the note copy', () => {
    const review = awaiting();
    const shown = readProposalIntoReview(review, proposal(REVISED, '세 군데를 바꿨어요.'));
    expect(shown).toBe('세 군데를 바꿨어요.');
    expect(review.status).toBe('pending');
    expect(review.hunks).toHaveLength(3);
  });

  it('leaves an ordinary answer alone and the review awaiting', () => {
    const review = awaiting();
    expect(readProposalIntoReview(review, '요약입니다.')).toBeNull();
    expect(review.status).toBe('awaiting');
  });

  it('marks a broken proposal malformed and shows the raw answer', () => {
    const review = awaiting();
    expect(readProposalIntoReview(review, `${EDIT_PROPOSAL_BEGIN}\n# 제목`)).toBeNull();
    expect(review.status).toBe('malformed');
  });

  it('reads only the first finished text block of a turn', () => {
    const review = awaiting();
    readProposalIntoReview(review, proposal(REVISED));
    expect(readProposalIntoReview(review, proposal(BASE))).toBeNull();
    expect(review.hunks).toHaveLength(3);
  });
});

describe('sameNote (T1)', () => {
  it('treats CRLF and LF as the same note', () => expect(sameNote('a\r\nb\r\n', 'a\nb\n')).toBe(true));
  it('does not ignore a missing final newline', () => expect(sameNote('a\nb', 'a\nb\n')).toBe(false));
  it('fails closed on a lone carriage return', () => expect(sameNote('a\rb\n', 'a\nb\n')).toBe(false));
});

describe('applyReviewHunks on the real file text (T2)', () => {
  it('keeps the file\'s own endings when the base was captured as LF', () => {
    const h = buildReviewHunks('a\nb\nc\n', 'a\nB\nc\n');
    expect(applyReviewHunks('a\r\nb\nc\r\n', h, h.map((x) => x.id))).toBe('a\r\nB\nc\r\n');
  });
});

function applyChanges(text: string, changes: Array<{ from: number; to: number; text: string }>): string {
  // pre-change coordinates, applied bottom-up
  return [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.text + t.slice(c.to), text);
}

describe('toEditorChanges (T3-T5)', () => {
  it('emits exactly one change for the one accepted hunk (T3)', () => {
    const base = 'a\nb\nc\n';
    const h = buildReviewHunks(base, 'A\nb\nC\n');
    const changes = toEditorChanges(base, h, [h[0].id]);
    expect(changes).toEqual([{ from: 0, to: 2, text: 'A\n' }]);
    expect(applyChanges(base, changes)).toBe('A\nb\nc\n');
  });

  it.each([
    ['insert at the end', 'a\nb\nc', 'a\nb\nc'],
    ['delete the last line', 'a', 'a\n'],
    ['replace the last line with two', 'a\nx\ny', 'a\nx\ny'],
  ])('handles a base without a final newline: %s (T4)', (_name, revised, expected) => {
    const base = 'a\nb';
    const h = buildReviewHunks(base, revised);
    const ids = h.map((x) => x.id);
    expect(applyChanges(base, toEditorChanges(base, h, ids))).toBe(expected);
    expect(applyReviewHunks(base, h, ids)).toBe(expected);
  });

  it('keeps two hunks independent in pre-change coordinates (T5)', () => {
    const base = '1\n2\n3\n4\n5\n';
    const h = buildReviewHunks(base, '1\nx\ny\n2\n3\nFOUR\n5\n');
    expect(applyChanges(base, toEditorChanges(base, h, h.map((x) => x.id)))).toBe('1\nx\ny\n2\n3\nFOUR\n5\n');
  });
});
