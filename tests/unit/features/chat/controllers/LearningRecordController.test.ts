/**
 * The save click flow against the real save service and a fake vault: preview first, consent
 * every time, bound to the snapshot's own conversation.
 */
import { Notice } from 'obsidian';

import { LearningRecordSaveService, sha256 } from '@/core/learning/records';
import { LearningRecordController } from '@/features/chat/controllers/LearningRecordController';

import { MemoryFs, MemoryHost, quizConversation, quizSnapshot } from '../../../core/learning/records/helpers';

const modalInputs: any[] = [];
let modalAnswer: { fileName: string; markdown: string } | null = null;
jest.mock('@/ui/modals/LearningRecordSaveModal', () => ({
  LearningRecordSaveModal: class {
    constructor(_app: unknown, private readonly input: unknown) {
      modalInputs.push(input);
    }
    openAndWait() {
      return Promise.resolve(modalAnswer);
    }
  },
}));

const FOLDER = '.ai-tutor/learning-records';
/** A usable record (these tests are about the save flow, not about invalid bytes). */
const BODY_ONE = '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "lr-one"\n---\n\nbody one\n';

function setup(snapshot = quizSnapshot()) {
  const fs = new MemoryFs();
  const host = new MemoryHost(snapshot, fs);
  const service = new LearningRecordSaveService(host);
  const openLinkText = jest.fn().mockResolvedValue(undefined);
  const plugin: any = {
    app: { workspace: { openLinkText } },
    settings: { learningRecordsFolder: FOLDER },
    getLearningSnapshot: () => host.snapshot,
    getConversationById: () => quizConversation(),
    getLearningRecordSaveService: () => service,
  };
  return { fs, host, service, controller: new LearningRecordController(plugin), openLinkText };
}

beforeEach(() => {
  modalInputs.length = 0;
  modalAnswer = null;
  (Notice as any).messages = [];
});

describe('LearningRecordController', () => {
  it('shows the exact destination and content first, and writes nothing when the student declines', async () => {
    const { controller, fs, host } = setup();
    expect(await controller.openSave('conv-1', 'a3')).toBeNull();
    expect(modalInputs).toHaveLength(1);
    expect(modalInputs[0]).toMatchObject({ folder: FOLDER });
    expect(modalInputs[0].markdown).toContain('type: ai-tutor-learning-record');
    expect(modalInputs[0].markdown).toContain('> ## 1/2번 문제');
    expect(fs.createCalls).toBe(0);
    expect(fs.files.size).toBe(0);
    expect(host.commits).toBe(0);
  });

  it('saves the edited text under the confirmed name, with no provider involved', async () => {
    const { controller, fs } = setup();
    const draftFirst = { fileName: '내 퀴즈 기록', markdown: '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "lr-9"\n---\n\n# 고친 제목\n' };
    modalAnswer = draftFirst;
    const outcome = await controller.openSave('conv-1', 'a3');
    expect(outcome).toMatchObject({ kind: 'saved', path: `${FOLDER}/내 퀴즈 기록.md` });
    expect(fs.files.get(`${FOLDER}/내 퀴즈 기록.md`)).toBe(draftFirst.markdown);
  });

  it('opens an already-saved note instead of showing a new preview or rewriting it', async () => {
    const { controller, fs, openLinkText } = setup();
    modalAnswer = { fileName: 'x', markdown: BODY_ONE };
    await controller.openSave('conv-1', 'a3');
    modalInputs.length = 0;
    const result = await controller.openSave('conv-1', 'a3');
    expect(result).toEqual({ kind: 'already-saved', path: `${FOLDER}/x.md` });
    expect(modalInputs).toHaveLength(0);
    expect(openLinkText).toHaveBeenCalledWith(`${FOLDER}/x.md`, '', false);
    expect(fs.createCalls).toBe(1);
  });

  it('explains a deleted note and recreates only after the student confirms a fresh save', async () => {
    const { controller, fs } = setup();
    modalAnswer = { fileName: 'x', markdown: BODY_ONE };
    await controller.openSave('conv-1', 'a3');
    fs.files.delete(`${FOLDER}/x.md`);
    modalInputs.length = 0;
    modalAnswer = null;
    await controller.openSave('conv-1', 'a3');
    expect(modalInputs[0].banner).toContain('자동으로 다시 만들지 않습니다');
    expect(modalInputs[0].confirmLabel).toBe('새로 저장');
    expect(fs.files.size).toBe(0);

    modalAnswer = { fileName: 'x', markdown: BODY_ONE };
    const outcome = await controller.openSave('conv-1', 'a3');
    expect(outcome).toMatchObject({ kind: 'saved' });
    expect(fs.files.get(`${FOLDER}/x.md`)).toBe(BODY_ONE);
  });

  it('keeps an edited target and asks for a different file name', async () => {
    const { controller, fs } = setup();
    modalAnswer = { fileName: 'x', markdown: BODY_ONE };
    await controller.openSave('conv-1', 'a3');
    fs.files.set(`${FOLDER}/x.md`, 'student edited this');
    modalInputs.length = 0;
    modalAnswer = null;
    await controller.openSave('conv-1', 'a3');
    expect(modalInputs[0].banner).toContain('다른 내용의 파일');
    expect(fs.files.get(`${FOLDER}/x.md`)).toBe('student edited this');
  });

  it('repairs only the history link when the note exists but the link was never acknowledged', async () => {
    const { controller, fs, host } = setup();
    host.snapshot = quizSnapshot({
      pendingSave: {
        saveIntentId: 's', recordId: 'lr-1', conversationId: 'conv-1', completionMessageId: 'a3', previewRevision: 1,
        folder: FOLDER, path: `${FOLDER}/x.md`, contentFingerprint: sha256(BODY_ONE), frozenAt: 1,
      },
    });
    fs.files.set(`${FOLDER}/x.md`, BODY_ONE);
    const outcome = await controller.openSave('conv-1', 'a3');
    expect(outcome).toEqual({ kind: 'already-saved', path: `${FOLDER}/x.md` });
    expect(modalInputs).toHaveLength(0);
    expect(fs.createCalls).toBe(0);
    expect(host.snapshot?.saved?.path).toBe(`${FOLDER}/x.md`);
  });

  it('refuses a message without a snapshot, such as a legacy turn', async () => {
    const { controller, host } = setup();
    host.snapshot = null;
    expect(await controller.openSave('conv-1', 'a3')).toBeNull();
    expect(modalInputs).toHaveLength(0);
    expect((Notice as any).messages.join('\n')).toContain('초안을 찾을 수 없습니다');
  });

  it('uses the snapshot\'s own conversation rather than whatever is open', async () => {
    const { controller } = setup();
    const seen: string[] = [];
    const plugin: any = (controller as any).plugin;
    plugin.getConversationById = (id: string) => { seen.push(id); return quizConversation(); };
    await controller.openSave('conv-1', 'a3');
    expect(seen).toEqual(['conv-1']);
  });

  it('does not report a note without usable record metadata as a saved learning record', async () => {
    const { controller, fs, host } = setup();
    modalAnswer = { fileName: 'edited', markdown: '# 내가 편집한 기록\n\n본문만 남김' };
    const outcome = await controller.openSave('conv-1', 'a3');
    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid-record' });
    expect(fs.createCalls).toBe(0);
    expect(fs.files.size).toBe(0);
    expect(host.commits).toBe(0);
    const notices = (Notice as any).messages.join('\n');
    expect(notices).not.toContain('저장했습니다');
    expect(notices).toContain('학습 기록 형식');
  });
});
