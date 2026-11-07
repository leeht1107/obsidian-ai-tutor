import {
  buildRecordContext,
  buildRecordDraft,
  canContinueRecord,
  discoverRecords,
  parseRecordSummary,
  readRecordBodies,
} from '../../../../../src/core/learning/records';
import { MemoryFs, msg, quizConversation, quizSnapshot } from './helpers';

const FOLDER = '.ai-tutor/learning-records';
const FIXED = Date.UTC(2026, 10, 7, 3, 0, 0);
const PLACEHOLDER_NEW = /\(비어 있음[^\n]*\)/;

function completedQuiz() {
  return buildRecordDraft({ snapshot: quizSnapshot(), conversation: quizConversation(), folder: FOLDER, now: FIXED, recordId: 'lr-1', saveIntentId: 'si-1' }).markdown;
}

/** What the student does in the editable preview: type under "다시 볼 것 / 스스로 점검". */
function studentWrites(markdown: string, text: string): string {
  const heading = '## 3. 다시 볼 것 / 스스로 점검 (직접 작성)\n\n';
  const at = markdown.indexOf(heading);
  expect(at).toBeGreaterThan(-1);
  return markdown.replace(heading, `${heading}${text}\n\n`);
}

function summaryOf(markdown: string) {
  const summary = parseRecordSummary('p.md', markdown, markdown.length);
  if (!summary) throw new Error('not a record');
  return summary;
}

describe('continue availability comes only from actual remaining questions', () => {
  it('a completed quiz record with the untouched draft cannot be continued', () => {
    const markdown = completedQuiz();
    expect(markdown).toMatch(/remainingQuestions: 0\n/);
    expect(markdown).toMatch(PLACEHOLDER_NEW);
    expect(canContinueRecord(summaryOf(markdown))).toBe(false);
  });

  it('a student-written next topic at remainingQuestions 0 does NOT enable continue (memo stays in the file)', () => {
    const markdown = studentWrites(completedQuiz(), '- 분수의 덧셈에서 통분이 왜 필요한지 다시 설명해 보기');
    const summary = summaryOf(markdown);
    expect(summary.remainingQuestions).toBe(0);
    expect(canContinueRecord(summary)).toBe(false);
    expect(markdown).toContain('분수의 덧셈에서 통분이 왜 필요한지');
  });

  it('remainingQuestions > 0 enables continue, with or without a student memo', () => {
    const unfinished = completedQuiz().replace('remainingQuestions: 0', 'remainingQuestions: 3');
    expect(canContinueRecord(summaryOf(unfinished))).toBe(true);
    expect(canContinueRecord(summaryOf(studentWrites(unfinished, '- 메모')))).toBe(true);
  });

  it('the Socratic completed record with a memo and zero remaining stays not continuable (c5 reproducer)', () => {
    const text = ['---', 'type: ai-tutor-learning-record', 'formatVersion: 1', 'recordId: "record-1"', 'mode: socratic', 'remainingQuestions: 0', '---', '# Record', '## 다시 볼 것 / 스스로 점검', '- Review supply and demand'].join('\n');
    expect(canContinueRecord(summaryOf(text))).toBe(false);
  });

  it('works for a completed Socratic record as well', () => {
    const conversation = { ...quizConversation(), messages: [msg('u9', 'user', '내 정리'), msg('s1', 'assistant', '##SOCRATIC_SUMMARY##\n요약')] };
    const draft = buildRecordDraft({
      snapshot: quizSnapshot({ mode: 'socratic', origin: 'socratic', completionMessageId: 's1', summaryMessageId: 's1', synthesisMessageId: 'u9', questions: [] }),
      conversation, folder: FOLDER, now: FIXED,
    });
    expect(canContinueRecord(summaryOf(draft.markdown))).toBe(false);
    expect(canContinueRecord(summaryOf(studentWrites(draft.markdown, '다음에는 극한의 정의부터')))).toBe(false);
  });

  it.each([
    ['empty lines', ''],
    ['only bullets and checkboxes', '-\n- [ ]\n*\n'],
    ['the new placeholder text alone', '(비어 있음 — 아무것도 적지 않음)'],
    ['the older placeholder text alone', '(비어 있음 — 다시 확인하고 싶은 것을 직접 적으세요)'],
    ['an explicit "none" marker', '(없음)'],
    ['an HTML comment', '<!-- 나중에 적기 -->'],
    ['punctuation only', '...'],
  ])('stays unavailable for %s', (_label, text) => {
    expect(canContinueRecord(summaryOf(studentWrites(completedQuiz(), text)))).toBe(false);
  });

  it('does not count AI prose, imported quotes or other sections as a student topic', () => {
    const markdown = completedQuiz();
    // Section 4 and 5 hold the student synthesis and the quoted AI summary; only section 3 counts.
    expect(markdown).toContain('## 5. 기존 AI 요약');
    expect(canContinueRecord(summaryOf(markdown.replace('(비어 있음 — 직접 정리하고 싶다면 적으세요)', '직접 정리한 내용')))).toBe(false);
  });

  it('metadata counts alone still enable continue for an unfinished quiz (old behaviour kept)', () => {
    const unfinished = completedQuiz().replace('remainingQuestions: 0', 'remainingQuestions: 2');
    expect(canContinueRecord(summaryOf(unfinished))).toBe(true);
  });

  it('ignores a section 3 heading that is only quoted text', () => {
    const quoted = completedQuiz().replace('## 5. 기존 AI 요약', '> ## 3. 다시 볼 것 / 스스로 점검\n> 가짜 주제\n\n## 5. 기존 AI 요약');
    expect(canContinueRecord(summaryOf(quoted))).toBe(false);
  });

  it('old files without the section keep working and are not continuable', () => {
    const old = '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "old"\nmode: socratic\nsourcePaths: []\nremainingQuestions: 0\n---\n\n# 옛 기록\n내용\n';
    expect(canContinueRecord(summaryOf(old))).toBe(false);
  });
});

describe('complete -> student edits next topic -> save -> list -> continue', () => {
  it('a saved memo-only record is listed and read as not continuable; only remaining questions enable it', async () => {
    const fs = new MemoryFs();
    const empty = completedQuiz();
    const withTopic = studentWrites(completedQuiz(), '- 통분이 필요한 이유').replace('recordId: "lr-1"', 'recordId: "lr-2"');
    const unfinished = completedQuiz().replace('remainingQuestions: 0', 'remainingQuestions: 2').replace('recordId: "lr-1"', 'recordId: "lr-3"');
    fs.files.set(`${FOLDER}/unfinished.md`, unfinished);
    fs.files.set(`${FOLDER}/empty.md`, empty);
    await fs.createOnly(`${FOLDER}/topic.md`, withTopic); // the save path writes the edited preview bytes verbatim

    const { records } = await discoverRecords(fs, FOLDER);
    expect(records).toHaveLength(3);
    expect(records.map((r) => [r.recordId, canContinueRecord(r)]).sort()).toEqual([['lr-1', false], ['lr-2', false], ['lr-3', true]]);

    const bodies = await readRecordBodies(fs, [`${FOLDER}/topic.md`, `${FOLDER}/empty.md`, `${FOLDER}/unfinished.md`]);
    expect(bodies.map((b) => b.canContinue)).toEqual([false, false, true]);
    expect(bodies[0].body).toContain('통분이 필요한 이유'); // memo content is preserved and still readable for Review
    expect(buildRecordContext('continue', bodies)).toContain('다시 볼 것 / 스스로 점검');
  });

  it('the fresh read reflects a remaining-question change made after the listing', async () => {
    const fs = new MemoryFs();
    fs.files.set(`${FOLDER}/a.md`, studentWrites(completedQuiz(), '다음 주제'));
    const listed = (await discoverRecords(fs, FOLDER)).records[0];
    expect(canContinueRecord(listed)).toBe(false);
    fs.files.set(`${FOLDER}/a.md`, studentWrites(completedQuiz(), '다음 주제').replace('remainingQuestions: 0', 'remainingQuestions: 1'));
    const [fresh] = await readRecordBodies(fs, [`${FOLDER}/a.md`]);
    expect(fresh.canContinue).toBe(true);
  });
});
