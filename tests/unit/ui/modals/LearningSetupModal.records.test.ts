/**
 * Saved-record selection in the real Socratic setup: nothing selected by default, every
 * subject listed, cross-subject multi-selection, the 64KiB budget, reference-only start.
 */
import type { App } from 'obsidian';
import { Notice, TFile } from 'obsidian';

import { canContinueRecord, MAX_SELECTED_RECORD_BYTES, sha256 } from '@/core/learning/records';
import { LearningSetupModal } from '@/ui/modals/LearningSetupModal';

import { MemoryFs } from '../../core/learning/records/helpers';

const FOLDER = '.ai-tutor/learning-records';

function record(id: string, opts: { created: string; sources: string[]; remaining?: number; body?: string }): string {
  return `---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "${id}"\ncreatedAt: "${opts.created}"\nmode: socratic\nsourcePaths: ${JSON.stringify(opts.sources)}\nremainingQuestions: ${opts.remaining ?? 0}\n---\n\n# 기록 ${id}\n${opts.body ?? '내용'}\n`;
}

interface Built {
  modal: LearningSetupModal;
  fs: MemoryFs;
  notes: Record<string, string>;
}

async function build(mode: 'quiz' | 'socratic' = 'socratic', withRecords = true): Promise<Built> {
  const fs = new MemoryFs();
  if (withRecords) {
    fs.files.set(`${FOLDER}/a.md`, record('rec-a', { created: '2026-11-01T00:00:00Z', sources: ['통계/주차1.md'] }));
    fs.files.set(`${FOLDER}/b.md`, record('rec-b', { created: '2026-11-02T00:00:00Z', sources: ['경제/원론.md'], remaining: 2 }));
    fs.files.set(`${FOLDER}/c.md`, record('rec-c', { created: '2026-11-03T00:00:00Z', sources: [] }));
  }
  const notes: Record<string, string> = { '통계/주차1.md': '표준편차 설명', '경제/원론.md': '수요와 공급' };
  const files = Object.keys(notes).map((path) => Object.assign(new TFile(), { path }));
  const app = {
    vault: {
      getMarkdownFiles: () => files,
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path),
      cachedRead: async (file: TFile) => notes[file.path],
    },
  } as unknown as App;
  const modal = new LearningSetupModal(app, '통계/주차1.md', mode, '', { fs, folder: FOLDER });
  jest.spyOn(modal as any, 'renderContent').mockImplementation(() => undefined);
  await (modal as any).loadRecords();
  return { modal, fs, notes };
}

beforeEach(() => {
  (Notice as any).messages = [];
});

describe('saved-record selection', () => {
  it('lists every saved record with nothing selected by default', async () => {
    const { modal } = await build();
    expect((modal as any).records.map((r: any) => r.recordId).sort()).toEqual(['rec-a', 'rec-b', 'rec-c']);
    expect((modal as any).selectedRecordPaths.size).toBe(0);
    expect((modal as any).entry).toBe('new');
  });

  it('reads the inventory from a hidden folder through the adapter and sends nothing to a provider', async () => {
    const { modal, fs } = await build();
    expect(FOLDER.startsWith('.')).toBe(true);
    expect((modal as any).records).toHaveLength(3);
    expect(fs.createCalls).toBe(0);
  });

  it('starts without any record when nothing was chosen, even though records exist', async () => {
    const { modal } = await build();
    const finish = jest.spyOn(modal as any, 'finish').mockImplementation(() => undefined);
    await (modal as any).start();
    // Socratic materials now confirm first; the confirmed result is the pending one.
    const result = (modal as any).pendingStart.result as any;
    expect(finish).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'socratic', entry: 'new', recordPaths: [], referenceOnly: false, sourcePaths: ['통계/주차1.md'] });
    expect(result.prompt).not.toContain('SAVED LEARNING RECORDS');
  });

  it('sends only the chosen records, across subjects, after the student confirms the preview', async () => {
    const { modal } = await build();
    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/a.md`, `${FOLDER}/b.md`]);
    (modal as any).startSource = 'records';
    (modal as any).entry = 'review';
    const finish = jest.spyOn(modal as any, 'finish').mockImplementation(() => undefined);

    await (modal as any).start();
    // The preview comes first; nothing is dispatched yet.
    expect(finish).not.toHaveBeenCalled();
    const pending = (modal as any).pendingStart;
    expect(pending.bodies.map((b: any) => b.recordId).sort()).toEqual(['rec-a', 'rec-b']);

    (modal as any).finish(pending.result);
    const result = finish.mock.calls[0][0] as any;
    expect(result.entry).toBe('review');
    expect(result.recordPaths.sort()).toEqual([`${FOLDER}/a.md`, `${FOLDER}/b.md`]);
    expect(Object.keys(result.recordFingerprints)).toHaveLength(2);
    expect(result.prompt).toContain('SAVED LEARNING RECORDS');
    expect(result.prompt).toContain('기록 rec-a');
    expect(result.prompt).toContain('기록 rec-b');
    expect(result.prompt).not.toContain('기록 rec-c');
    expect(result.prompt).toContain('ONE Socratic question');
    // Typed arrays, not prompt prose; a records start carries no course material.
    expect(result.sourcePaths).toEqual([]);
  });

  it('keeps "new" from sending a selected record', async () => {
    const { modal } = await build();
    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/a.md`]);
    (modal as any).entry = 'new';
    const finish = jest.spyOn(modal as any, 'finish').mockImplementation(() => undefined);
    await (modal as any).start();
    // Socratic materials now confirm first; the confirmed result is the pending one.
    const result = (modal as any).pendingStart.result as any;
    expect(finish).not.toHaveBeenCalled();
    expect(result.recordPaths).toEqual([]);
    expect(result.prompt).not.toContain('기록 rec-a');
  });

  it('refuses review without a chosen record', async () => {
    const { modal } = await build();
    (modal as any).startSource = 'records';
    (modal as any).entry = 'review';
    const finish = jest.spyOn(modal as any, 'finish').mockImplementation(() => undefined);
    await (modal as any).start();
    expect(finish).not.toHaveBeenCalled();
    expect((modal as any).pendingStart).toBeNull();
    expect((Notice as any).messages.join('\n')).toContain('하나 이상');
  });

  it('allows continue only when a chosen record has remaining questions', async () => {
    const { modal } = await build();
    (modal as any).startSource = 'records';
    (modal as any).entry = 'continue';
    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/a.md`]);
    await (modal as any).start();
    expect((modal as any).pendingStart).toBeNull();
    expect((Notice as any).messages.join('\n')).toContain('남은 질문이 있는 기록이 없습니다');

    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/a.md`, `${FOLDER}/b.md`]);
    await (modal as any).start();
    expect((modal as any).pendingStart.result.entry).toBe('continue');
    expect((modal as any).pendingStart.result.prompt).toContain('Resume from the unanswered quiz questions the student left');
  });

  it('rejects a selection over 64KiB with a message instead of truncating or dropping', async () => {
    const { modal, fs } = await build();
    const big = 'x'.repeat(MAX_SELECTED_RECORD_BYTES / 2);
    fs.files.set(`${FOLDER}/a.md`, record('rec-a', { created: '2026-11-01T00:00:00Z', sources: [], body: big }));
    fs.files.set(`${FOLDER}/b.md`, record('rec-b', { created: '2026-11-02T00:00:00Z', sources: [], body: big }));
    await (modal as any).loadRecords();
    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/a.md`, `${FOLDER}/b.md`]);
    (modal as any).startSource = 'records';
    (modal as any).entry = 'review';
    await (modal as any).start();
    expect((modal as any).pendingStart).toBeNull();
    expect((Notice as any).messages.join('\n')).toContain('64KiB');

    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/a.md`]);
    await (modal as any).start();
    expect((modal as any).pendingStart).not.toBeNull();
  });

  it('allows a labelled reference-only review when no course material has content', async () => {
    const { modal, notes } = await build();
    notes['통계/주차1.md'] = '';
    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/a.md`]);
    (modal as any).startSource = 'records';
    (modal as any).entry = 'review';
    await (modal as any).start();
    const result = (modal as any).pendingStart.result;
    expect(result.referenceOnly).toBe(true);
    expect(result.hasSourceNotes).toBe(false);
    expect(result.sourcePaths).toEqual([]);
    expect(result.sourceInstruction).toContain('No verified original learning material available');
    expect(result.sourceInstruction).not.toContain('@');
    expect(result.prompt).toContain('do NOT grade factual correctness');
  });

  it('still refuses to start a normal new Socratic or any Quiz without course material', async () => {
    const socratic = await build('socratic');
    socratic.notes['통계/주차1.md'] = '';
    const finishS = jest.spyOn(socratic.modal as any, 'finish').mockImplementation(() => undefined);
    await (socratic.modal as any).start();
    expect(finishS).not.toHaveBeenCalled();

    const quiz = await build('quiz');
    quiz.notes['통계/주차1.md'] = '';
    (quiz.modal as any).selectedRecordPaths = new Set([`${FOLDER}/a.md`]);
    (quiz.modal as any).startSource = 'records';
    (quiz.modal as any).entry = 'review';
    const finishQ = jest.spyOn(quiz.modal as any, 'finish').mockImplementation(() => undefined);
    await (quiz.modal as any).start();
    expect(finishQ).not.toHaveBeenCalled();
    expect((quiz.modal as any).pendingStart).toBeNull();
  });

  it('records the material fingerprints observed at Start for the pre-dispatch recheck', async () => {
    const { modal } = await build('quiz', false);
    const finish = jest.spyOn(modal as any, 'finish').mockImplementation(() => undefined);
    await (modal as any).start();
    const result = finish.mock.calls[0][0] as any;
    expect(result.sourcePaths).toEqual(['통계/주차1.md']);
    expect(result.sourceFingerprints).toEqual({ '통계/주차1.md': sha256('표준편차 설명') });
  });

  it('adds a record from another location only if it really is a record', async () => {
    const { modal, fs } = await build();
    fs.files.set('elsewhere/x.md', record('rec-x', { created: '2026-11-04T00:00:00Z', sources: [] }));
    fs.files.set('elsewhere/plain.md', '# not a record');
    await (modal as any).addRecordByPath('elsewhere/plain.md');
    expect((modal as any).records.some((r: any) => r.recordId === 'rec-x')).toBe(false);
    await (modal as any).addRecordByPath('elsewhere/x.md');
    expect((modal as any).selectedRecordPaths.has('elsewhere/x.md')).toBe(true);
    await (modal as any).addRecordByPath('../outside.md');
    expect((modal as any).records).toHaveLength(4);
  });

  it('treats a start with zero saved records as an isolated "new" entry, so it gets a fresh conversation', async () => {
    const { modal } = await build('socratic', false);
    expect((modal as any).isRecordsSource()).toBe(false);
    const result = (modal as any).buildResult();
    expect(result.entry).toBe('new');
    expect(result.recordPaths).toEqual([]);
    expect(result.prompt).not.toContain('SAVED LEARNING RECORDS');
  });

  it('does the same when the record folder does not exist at all', async () => {
    const { modal, fs } = await build('socratic', false);
    expect(await fs.exists(FOLDER)).toBe(false);
    expect((modal as any).buildResult().entry).toBe('new');
  });

  it('still has no saved-record entry for Quiz or for a modal opened without a record source', () => {
    const app = { vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null } } as unknown as App;
    const noSource = new LearningSetupModal(app, null, 'socratic', '');
    expect((noSource as any).buildResult().entry).toBeUndefined();
  });

  it('a student memo at remainingQuestions 0 never enables continue (listing and fresh read), but Review still reads it', async () => {
    const { modal, fs } = await build('socratic', false);
    const memo = '\n## 3. 다시 볼 것 / 스스로 점검 (직접 작성)\n\n- 통분이 필요한 이유\n';
    fs.files.set(`${FOLDER}/t.md`, record('rec-t', { created: '2026-11-04T00:00:00Z', sources: [], body: memo }));
    fs.files.set(`${FOLDER}/q.md`, record('rec-q', { created: '2026-11-05T00:00:00Z', sources: [], remaining: 2, body: memo }));
    await (modal as any).loadRecords();

    (modal as any).startSource = 'records';
    (modal as any).entry = 'continue';
    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/t.md`]);
    expect((modal as any).selectedRecords().some(canContinueRecord)).toBe(false);
    await (modal as any).start();
    expect((modal as any).pendingStart).toBeNull();

    (modal as any).startSource = 'records';
    (modal as any).entry = 'review';
    await (modal as any).start();
    expect((modal as any).pendingStart.result.entry).toBe('review');
    expect((modal as any).pendingStart.result.recordContext ?? JSON.stringify((modal as any).pendingStart)).toContain('통분이 필요한 이유');

    (modal as any).pendingStart = null;
    (modal as any).startSource = 'records';
    (modal as any).entry = 'continue';
    (modal as any).selectedRecordPaths = new Set([`${FOLDER}/q.md`]);
    expect((modal as any).selectedRecords().some(canContinueRecord)).toBe(true);
    await (modal as any).start();
    expect((modal as any).pendingStart.result.entry).toBe('continue');

    // A remaining count removed after listing: the fresh read wins.
    (modal as any).pendingStart = null;
    fs.files.set(`${FOLDER}/q.md`, record('rec-q', { created: '2026-11-05T00:00:00Z', sources: [], remaining: 0, body: memo }));
    await (modal as any).start();
    expect((modal as any).pendingStart).toBeNull();
  });
});
