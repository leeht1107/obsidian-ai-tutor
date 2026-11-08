/**
 * Production wiring of completed-learning snapshots, fresh saved-record starts and the
 * fingerprint recheck, driven through the real InputController, ChatState and parsers.
 */
import { Notice, TFile } from 'obsidian';

import { normalizeQuizMarkdown, parseQuizQuestionMeta, parseSocraticMeta } from '@/core/learning';
import { sha256 } from '@/core/learning/records';
import type { ChatMessage } from '@/core/types';
import { InputController, type InputControllerDeps } from '@/features/chat/controllers/InputController';
import { ChatState } from '@/features/chat/state/ChatState';
import { LearningSetupModal } from '@/ui/modals/LearningSetupModal';

const renderActions = jest.fn();
jest.mock('@/features/chat/rendering/MessageRenderer', () => ({
  renderQuizReviewButton: jest.fn(),
  renderLearningRecordActions: (...args: unknown[]) => renderActions(...args),
}));

const QUESTION = (n: number, total: number) => `## ${n}/${total}번 문제\n\n#### 질문 ${n}\n\nA. 가\nB. 나`;

interface Harness {
  deps: InputControllerDeps;
  controller: InputController;
  state: ChatState;
  attach: jest.Mock;
  createNew: jest.Mock;
  resetSession: jest.Mock;
  replies: Array<string | Error>;
  prompts: string[];
  files: Map<string, string>;
  imageManager: { clearImages: jest.Mock };
}

function harness(opts: {
  attachResult?: boolean;
  images?: any[];
  externalContexts?: string[];
  /** Awaited inside every vault.read, so a test can hold the fingerprint re-check open. */
  readGate?: () => Promise<void>;
} = {}): Harness {
  const state = new ChatState();
  state.currentConversationId = 'conv-1';
  const replies: Array<string | Error> = [];
  const prompts: string[] = [];
  const files = new Map<string, string>();
  const attach = jest.fn().mockResolvedValue(opts.attachResult ?? true);
  const createNew = jest.fn().mockImplementation(async () => {
    state.clearMessages();
    state.quizSession = null;
    state.socraticSession = null;
    state.currentConversationId = 'conv-2';
  });
  const resetSession = jest.fn();
  let pending = '';
  const contentEl = {};
  const imageManager = {
    hasImages: () => (opts.images?.length ?? 0) > 0,
    getAttachedImages: () => opts.images ?? [],
    clearImages: jest.fn(),
    setImages: jest.fn(),
  };
  const vaultFiles = new Map<string, TFile>();

  const deps = {
    plugin: {
      app: {
        vault: {
          getAbstractFileByPath: (path: string) => {
            if (!files.has(path)) return null;
            if (!vaultFiles.has(path)) vaultFiles.set(path, Object.assign(new TFile(), { path }));
            return vaultFiles.get(path);
          },
          read: async (file: TFile) => {
            await opts.readGate?.();
            return files.get(file.path) as string;
          },
          adapter: {
            exists: async (p: string) => files.has(p),
            read: async (p: string) => {
              await opts.readGate?.();
              return files.get(p) as string;
            },
            stat: async (p: string) => ({ size: (files.get(p) ?? '').length }),
            list: async () => ({ files: [], folders: [] }),
          },
        },
      },
      agentService: {
        query: jest.fn().mockImplementation(async function* (prompt: string) {
          prompts.push(prompt);
          const next = replies.shift();
          if (next instanceof Error) throw next;
          yield { type: 'text', content: next ?? '' };
          yield { type: 'done' };
        }),
        cancel: jest.fn(),
        resetSession,
        getSessionId: jest.fn().mockReturnValue(null),
        setSessionId: jest.fn(),
      },
      settings: { enableAutoTitleGeneration: false, slashCommands: [], learningRecordsFolder: '.ai-tutor/learning-records', blockedCommands: { unix: [], windows: [] }, enableBlocklist: true },
      attachLearningSnapshot: attach,
      getLearningRecordSaveService: () => ({ isSaving: () => false }),
      updateConversation: jest.fn(),
      renameConversation: jest.fn(),
      getConversationById: jest.fn().mockReturnValue(null),
    } as any,
    state,
    renderer: {
      addMessage: jest.fn().mockReturnValue({ querySelector: () => contentEl }),
    } as any,
    streamController: {
      showThinkingIndicator: jest.fn(),
      hideThinkingIndicator: jest.fn(),
      handleStreamChunk: jest.fn().mockImplementation(async (chunk: { type: string; content?: string }) => {
        if (chunk.type === 'text') pending += chunk.content ?? '';
      }),
      // Same field assignments as StreamController.finalizeCurrentTextBlock.
      finalizeCurrentTextBlock: jest.fn().mockImplementation(async (msg: ChatMessage) => {
        const text = normalizeQuizMarkdown(pending);
        pending = '';
        if (!text) return;
        msg.content = text;
        msg.contentBlocks = [{ type: 'text', content: text }];
        msg.quizQuestion = parseQuizQuestionMeta(text);
        msg.socraticTurn = parseSocraticMeta(text);
      }),
      finalizeCurrentThinkingBlock: jest.fn(),
      appendText: jest.fn(),
      injectChoiceButtonsIfNeeded: jest.fn(),
    } as any,
    selectionController: { getContext: jest.fn().mockReturnValue({ notePath: 'other.md', mode: 'selection', selectedText: 'LEAKED SELECTION' }) } as any,
    conversationController: { save: jest.fn().mockResolvedValue(undefined), createNew, generateFallbackTitle: jest.fn().mockReturnValue('t'), updateHistoryDropdown: jest.fn() } as any,
    getInputEl: () => ({ value: '', focus: jest.fn() }) as unknown as HTMLTextAreaElement,
    getWelcomeEl: () => null,
    getMessagesEl: () => ({ parentElement: null, querySelectorAll: () => [] }) as any,
    getFileContextManager: () => ({
      startSession: jest.fn(),
      getCurrentNotePath: jest.fn().mockReturnValue('open-note.md'),
      shouldSendCurrentNote: jest.fn().mockReturnValue(true),
      transformContextMentions: (t: string) => t,
    }) as any,
    getImageContextManager: () => imageManager as any,
    getSlashCommandManager: () => null,
    getWebSearchToggle: () => ({ isEnabled: () => false }),
    getExternalContextSelector: () => (opts.externalContexts ? { getExternalContexts: () => opts.externalContexts as string[] } : null),
    getInstructionModeManager: () => null,
    getInstructionRefineService: () => null,
    getTitleGenerationService: () => null,
    getComponent: () => ({}) as any,
    setBashExpansionActive: jest.fn(),
    generateId: (() => { let n = 0; return () => `m${++n}`; })(),
    resetContextMeter: jest.fn(),
  } as InputControllerDeps;
  return { deps, controller: new InputController(deps), state, attach, createNew, resetSession, replies, prompts, files, imageManager };
}

const quizInit = (total = 2) => ({
  totalQuestions: total, scopeLabel: '/quiz · 노트', sourceInstruction: 'src', sourcePaths: ['과목A/노트.md'], sourceFingerprints: { '과목A/노트.md': 'f' },
});

async function runQuiz(h: Harness, final: string): Promise<void> {
  h.replies.push(QUESTION(1, 2), `### 정답 확인\n\n${QUESTION(2, 2)}`, final);
  await h.controller.sendMessage({ content: 'quiz prompt', displayContentOverride: '/quiz · 노트', quizSessionInit: quizInit() });
  await h.controller.sendMessage({ content: 'B' });
  await h.controller.sendMessage({ content: 'A' });
}

beforeEach(() => {
  jest.clearAllMocks();
  (Notice as any).messages = [];
});

describe('completed Quiz', () => {
  it('stores a snapshot bound to the real transcript after storage acknowledges it', async () => {
    const h = harness();
    await runQuiz(h, '### 정답 확인\n- 정오: 오답\n\n### 학습 요약 (AI 초안)\n- 복습');

    expect(h.attach).toHaveBeenCalledTimes(1);
    const [conversationId, messageId, snapshot] = h.attach.mock.calls[0];
    const final = h.state.messages[h.state.messages.length - 1];
    expect(conversationId).toBe('conv-1');
    expect(messageId).toBe(final.id);
    expect(snapshot).toMatchObject({
      version: 1, mode: 'quiz', origin: 'quiz', conversationId: 'conv-1', completionMessageId: final.id,
      sourcePaths: ['과목A/노트.md'], sourceFingerprints: { '과목A/노트.md': 'f' }, totalQuestions: 2, reportOrigin: 'ai-draft',
    });
    expect(snapshot.questions.map((q: any) => [q.questionNumber, !!q.answerMessageId, !!q.feedbackMessageId])).toEqual([[1, true, true], [2, true, true]]);
    expect(final.learningSnapshot).toBe(snapshot);
    expect(final.quizQuestion).toBeNull();
    expect(final.quizReviewAvailable).toBe(true);
    expect(renderActions).toHaveBeenCalledTimes(1);
    expect(h.state.quizSession).toBeNull();
  });

  it('exposes no draft when the storage write is not acknowledged', async () => {
    const h = harness({ attachResult: false });
    await runQuiz(h, '### 정답 확인');
    const final = h.state.messages[h.state.messages.length - 1];
    expect(final.learningSnapshot).toBeUndefined();
    expect(renderActions).not.toHaveBeenCalled();
    expect((Notice as any).messages.join('\n')).toContain('안전하게 저장하지 못해');
  });

  it('falls back to a local-evidence report when the final reply has no AI summary', async () => {
    const h = harness();
    await runQuiz(h, '### 정답 확인\n- 정오: 오답');
    expect(h.attach.mock.calls[0][2].reportOrigin).toBe('local-evidence');
  });

  it('does not create a snapshot before the last question or for a failed final reply', async () => {
    const h = harness();
    h.replies.push(QUESTION(1, 2), `### 정답 확인\n\n${QUESTION(2, 2)}`, new Error('provider down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await h.controller.sendMessage({ content: 'quiz prompt', displayContentOverride: '/quiz · 노트', quizSessionInit: quizInit() });
    await h.controller.sendMessage({ content: 'B' });
    await h.controller.sendMessage({ content: 'A' });
    expect(h.attach).not.toHaveBeenCalled();
  });

  it('keeps hint turns out of the answer and feedback references', async () => {
    const h = harness();
    h.replies.push(QUESTION(1, 2), '힌트입니다', `### 정답 확인\n\n${QUESTION(2, 2)}`, '### 정답 확인\n끝');
    await h.controller.sendMessage({ content: 'quiz prompt', displayContentOverride: '/quiz · 노트', quizSessionInit: quizInit() });
    await h.controller.sendMessage({ content: '힌트 주세요', quizHintRequest: true });
    await h.controller.sendMessage({ content: 'B' });
    await h.controller.sendMessage({ content: 'A' });
    const snapshot = h.attach.mock.calls[0][2];
    const byId = new Map(h.state.messages.map((m) => [m.id, m]));
    expect(byId.get(snapshot.questions[0].answerMessageId)?.content).toBe('B');
    expect(byId.get(snapshot.questions[0].feedbackMessageId)?.content).toContain('정답 확인');
    expect(h.state.messages.find((m) => m.quizHint)?.content).toBe('힌트 주세요');
  });
});

describe('completed Socratic', () => {
  const socraticInit = { scopeLabel: '/socratic · 노트', sourceInstruction: 'src', sourcePaths: ['과목A/노트.md'] };

  it('creates a snapshot only for the real summary turn and binds the synthesis sent in summary phase', async () => {
    const h = harness();
    h.replies.push('첫 질문', '마지막 정리 질문', '##SOCRATIC_SUMMARY##\n### 발견의 여정 요약\n학생이 이해했다');
    await h.controller.sendMessage({ content: 'start', displayContentOverride: '/socratic', socraticSessionInit: socraticInit });
    await h.controller.sendMessage({ content: '답1' });
    expect(h.attach).not.toHaveBeenCalled();
    h.state.socraticSession = { ...h.state.socraticSession!, isSummaryPhase: true };
    await h.controller.sendMessage({ content: '내 최종 정리' });

    expect(h.attach).toHaveBeenCalledTimes(1);
    const snapshot = h.attach.mock.calls[0][2];
    const synthesis = h.state.messages.find((m) => m.id === snapshot.synthesisMessageId);
    expect(snapshot).toMatchObject({ mode: 'socratic', origin: 'socratic', sourcePaths: ['과목A/노트.md'] });
    expect(synthesis?.content).toBe('내 최종 정리');
    expect(h.state.socraticSession).toBeNull();
  });

  it('records no synthesis when the summary came without a summary-phase reply', async () => {
    const h = harness();
    h.replies.push('첫 질문', '##SOCRATIC_SUMMARY##\n### 요약\n끝');
    await h.controller.sendMessage({ content: 'start', displayContentOverride: '/socratic', socraticSessionInit: socraticInit });
    await h.controller.sendMessage({ content: '답1' });
    expect(h.attach.mock.calls[0][2].synthesisMessageId).toBeUndefined();
  });

  it.each([
    ['fenced marker', '예시:\n```\n##SOCRATIC_SUMMARY##\n### 요약\n```\n계속해요'],
    ['quoted marker', '> ##SOCRATIC_SUMMARY##\n> ### 요약'],
    ['cut-off marker', '##SOCRATIC_SUMMARY##'],
    ['four-space indented code', '코드 예시입니다:\n\n    ##SOCRATIC_SUMMARY##\n    ### 발견의 여정 요약\n    이 문장은 코드 예시다.'],
    ['tab indented code', '코드 예시입니다:\n\n\t##SOCRATIC_SUMMARY##\n\t### 발견의 여정 요약\n\t이 문장은 코드 예시다.'],
  ])('does not treat a %s as completion', async (_name, reply) => {
    const h = harness();
    h.replies.push('첫 질문', reply);
    await h.controller.sendMessage({ content: 'start', displayContentOverride: '/socratic', socraticSessionInit: socraticInit });
    await h.controller.sendMessage({ content: '답1' });
    expect(h.attach).not.toHaveBeenCalled();
    expect(h.state.socraticSession).not.toBeNull();
  });

  it('does not complete from a summary the failed stream left behind', async () => {
    const h = harness();
    h.replies.push('첫 질문', new Error('cut'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await h.controller.sendMessage({ content: 'start', displayContentOverride: '/socratic', socraticSessionInit: socraticInit });
    await h.controller.sendMessage({ content: '답1' });
    expect(h.attach).not.toHaveBeenCalled();
  });

  it('marks a Quiz review snapshot as quiz-review', async () => {
    const h = harness();
    h.replies.push('첫 질문', '##SOCRATIC_SUMMARY##\n### 요약\n끝');
    await h.controller.sendMessage({ content: 'review', socraticSessionInit: { ...socraticInit, quizReview: true } });
    await h.controller.sendMessage({ content: '답1' });
    expect(h.attach.mock.calls[0][2].origin).toBe('quiz-review');
  });
});

describe('saved-record start', () => {
  const base = {
    mode: 'socratic' as const, prompt: 'record prompt', displayContent: '/socratic · 기록', sourceInstruction: 'src', hasSourceNotes: true,
    sourcePaths: [] as string[], sourceFingerprints: {} as Record<string, string>, entry: 'review' as const,
    recordPaths: [] as string[], recordFingerprints: {} as Record<string, string>, referenceOnly: false,
  };
  const send = (h: Harness, result: object) => (h.controller as any).sendLearningSetupResult(result, { editorContextOverride: { notePath: 'x', mode: 'selection', selectedText: 'S' } });

  it('opens a fresh conversation and provider session and sends neither the open note nor the editor selection', async () => {
    const h = harness();
    h.replies.push('요약과 질문 하나');
    h.state.addMessage({ id: 'old', role: 'user', content: 'old chat', timestamp: 1 });
    h.state.queuedMessage = { content: 'stale queued', skipLearningCommand: true } as any;
    await send(h, base);

    expect(h.createNew).toHaveBeenCalledTimes(1);
    expect(h.resetSession).toHaveBeenCalled();
    expect(h.state.currentConversationId).toBe('conv-2');
    expect(h.state.queuedMessage).toBeNull();
    expect(h.state.messages.map((m) => m.content)).not.toContain('old chat');
    expect(h.state.socraticSession?.recordEntry).toBe('review');
    expect(h.prompts[0]).toContain('record prompt');
    expect(h.prompts[0]).not.toContain('LEAKED SELECTION');
    expect(h.prompts[0]).not.toContain('open-note.md');
    expect(h.prompts[0]).not.toContain('old chat');
  });

  it('does nothing when a source changed after the preview', async () => {
    const h = harness();
    h.files.set('과목A/노트.md', 'changed after preview');
    await send(h, { ...base, sourcePaths: ['과목A/노트.md'], sourceFingerprints: { '과목A/노트.md': sha256('what the preview read') } });
    expect(h.createNew).not.toHaveBeenCalled();
    expect(h.prompts).toHaveLength(0);
    expect((Notice as any).messages.join('\n')).toContain('시작 직전에 바뀌었습니다');
  });

  it('does nothing when a selected record changed after the preview', async () => {
    const h = harness();
    const record = '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "r1"\n---\n\n# 기록\n';
    h.files.set('.ai-tutor/learning-records/a.md', `${record}edited later`);
    await send(h, { ...base, recordPaths: ['.ai-tutor/learning-records/a.md'], recordFingerprints: { '.ai-tutor/learning-records/a.md': sha256(record) } });
    expect(h.createNew).not.toHaveBeenCalled();
    expect(h.prompts).toHaveLength(0);
    expect((Notice as any).messages.join('\n')).toContain('미리보기 이후 바뀌었습니다');
  });

  it('proceeds when sources and records are unchanged', async () => {
    const h = harness();
    h.replies.push('ok');
    const record = '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "r1"\n---\n\n# 기록\n';
    h.files.set('.ai-tutor/learning-records/a.md', record);
    h.files.set('과목A/노트.md', '본문');
    await send(h, {
      ...base,
      sourcePaths: ['과목A/노트.md'], sourceFingerprints: { '과목A/노트.md': sha256('본문') },
      recordPaths: ['.ai-tutor/learning-records/a.md'], recordFingerprints: { '.ai-tutor/learning-records/a.md': sha256(record) },
    });
    expect(h.createNew).toHaveBeenCalledTimes(1);
    expect(h.prompts).toHaveLength(1);
  });

  it('gives a New start with zero saved records (even a missing folder) a fresh app and provider context', async () => {
    const h = harness();
    h.replies.push('q');
    h.state.addMessage({ id: 'old', role: 'user', content: 'old chat', timestamp: 1 });
    // The real setup modal, opened with the record source the controller would give it.
    const app = h.deps.plugin.app;
    app.vault.getMarkdownFiles = () => [];
    const modal = new LearningSetupModal(app, null, 'socratic', '주제', (h.controller as any).recordSource());
    jest.spyOn(modal as any, 'renderContent').mockImplementation(() => undefined);
    await (modal as any).loadRecords();
    expect((modal as any).records).toEqual([]);
    const result = (modal as any).buildResult();
    expect(result.entry).toBe('new');

    await send(h, { ...result, sourceInstruction: 'src', prompt: 'new prompt' });
    expect(h.createNew).toHaveBeenCalledTimes(1);
    expect(h.resetSession).toHaveBeenCalled();
    expect(h.state.currentConversationId).toBe('conv-2');
    expect(h.state.socraticSession?.recordEntry).toBe('new');
    expect(h.prompts[0]).toContain('new prompt');
    expect(h.prompts[0]).not.toContain('old chat');
  });

  it('leaves ordinary chat alone: no learning command, no fresh conversation', async () => {
    const h = harness();
    h.replies.push('hello back');
    await h.controller.sendMessage({ content: '그냥 질문입니다' });
    expect(h.createNew).not.toHaveBeenCalled();
    expect(h.resetSession).not.toHaveBeenCalled();
    expect(h.state.currentConversationId).toBe('conv-1');
  });

  it('keeps a live Quiz review in its own conversation (no fresh boundary)', async () => {
    const h = harness();
    h.replies.push('q');
    await h.controller.sendMessage({ content: 'review', socraticSessionInit: { scopeLabel: 'Quiz 복습', sourceInstruction: 's', quizReview: true } });
    expect(h.createNew).not.toHaveBeenCalled();
    expect(h.state.currentConversationId).toBe('conv-1');
  });

  it('leaves a plain Socratic start (no saved-record entry) on the existing path', async () => {
    const h = harness();
    h.replies.push('q');
    await send(h, { ...base, entry: undefined });
    expect(h.createNew).not.toHaveBeenCalled();
    expect(h.prompts[0]).toContain('LEAKED SELECTION'.slice(0, 0) + 'record prompt');
  });
});

describe('save and optional review are independent', () => {
  async function finishedQuiz(h: Harness) {
    await runQuiz(h, '### 정답 확인\n\n### 학습 요약 (AI 초안)\n- 요약');
    return h.state.messages[h.state.messages.length - 1];
  }

  it('lets the review start after a save without consuming or changing the saved reference', async () => {
    const h = harness();
    const final = await finishedQuiz(h);
    final.learningSnapshot = { ...final.learningSnapshot!, saved: { path: 'p.md', recordId: 'r', contentFingerprint: 'f', savedAt: 1 } };
    h.replies.push('복습 첫 질문');
    expect(await h.controller.startQuizReview(final.id)).toBe(true);
    expect(final.quizReviewAvailable).toBe(false);
    expect(final.learningSnapshot?.saved?.path).toBe('p.md');
    expect(h.state.socraticSession?.quizReview).toBe(true);
    expect(h.state.socraticSession?.sourcePaths).toEqual(['과목A/노트.md']);
    expect(h.createNew).not.toHaveBeenCalled();
  });

  it('keeps the Quiz report savable after the review was used', async () => {
    const h = harness();
    const final = await finishedQuiz(h);
    h.replies.push('복습 첫 질문');
    await h.controller.startQuizReview(final.id);
    expect(final.learningSnapshot?.mode).toBe('quiz');
    expect(final.learningSnapshot?.saved).toBeUndefined();
    expect(h.attach.mock.calls[0][1]).toBe(final.id);
  });

  it('waits for a save that is still writing instead of starting the review', async () => {
    const h = harness();
    const final = await finishedQuiz(h);
    (h.deps.plugin as any).getLearningRecordSaveService = () => ({ isSaving: () => true });
    expect(await h.controller.startQuizReview(final.id)).toBe(false);
    expect(final.quizReviewAvailable).toBe(true);
    expect(h.state.socraticSession).toBeNull();
  });

  it('gives the later Socratic report its own snapshot, separate from the Quiz report', async () => {
    const h = harness();
    const final = await finishedQuiz(h);
    h.replies.push('복습 첫 질문', '##SOCRATIC_SUMMARY##\n### 요약\n끝');
    await h.controller.startQuizReview(final.id);
    await h.controller.sendMessage({ content: '답' });
    const [first, second] = h.attach.mock.calls.map((call) => call[2]);
    expect(first.mode).toBe('quiz');
    expect(second).toMatchObject({ mode: 'socratic', origin: 'quiz-review' });
    expect(second.completionMessageId).not.toBe(first.completionMessageId);
    expect(second.pendingSave).toBeUndefined();
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('learning setup stays bound to the conversation that started it', () => {
  const SOURCE = '과목A/노트.md';
  const quizResult = {
    mode: 'quiz', prompt: 'quiz prompt A', displayContent: '/quiz · 노트', sourceInstruction: 'src', hasSourceNotes: true,
    sourcePaths: [SOURCE], sourceFingerprints: { [SOURCE]: sha256('본문') }, totalQuestions: 2, focusText: '',
    difficulty: '중', enableWebSearch: false, questionStyle: 'material',
  };
  const socraticResult = {
    mode: 'socratic', prompt: 'socratic prompt A', displayContent: '/socratic · 노트', sourceInstruction: 'src', hasSourceNotes: true,
    sourcePaths: [SOURCE], sourceFingerprints: { [SOURCE]: sha256('본문') }, focusText: '',
    recordPaths: [] as string[], recordFingerprints: {} as Record<string, string>, referenceOnly: false,
  };
  const RECORD = '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "r1"\n---\n\n# 기록\n';
  const RECORD_PATH = '.ai-tutor/learning-records/a.md';

  /** What ConversationController.switchTo does to the view state once streaming is not locked. */
  const switchToB = (h: Harness) => {
    h.state.currentConversationId = 'conv-B';
    h.state.messages = [{ id: 'b1', role: 'user', content: 'B PRIVATE HISTORY', timestamp: 1 }];
  };
  const queryOf = (h: Harness) => (h.deps.plugin as any).agentService.query as jest.Mock;
  const modalReturns = (result: object, during?: () => void) =>
    jest.spyOn(LearningSetupModal.prototype, 'openAndWait').mockImplementation(async () => {
      during?.();
      return result as any;
    });

  afterEach(() => jest.restoreAllMocks());

  it('positive control: /quiz with no conversation change starts the Quiz in the initiating conversation', async () => {
    const h = harness();
    h.files.set(SOURCE, '본문');
    h.replies.push(QUESTION(1, 2));
    modalReturns(quizResult);
    await h.controller.sendMessage({ content: '/quiz' });
    expect(h.prompts).toHaveLength(1);
    expect(h.state.quizSession?.totalQuestions).toBe(2);
    expect(h.state.currentConversationId).toBe('conv-1');
  });

  it('/quiz: switching conversations while the source re-check is awaited aborts without sending B history', async () => {
    const gate = deferred();
    const started = deferred();
    const h = harness({ readGate: () => { started.resolve(); return gate.promise; } });
    h.files.set(SOURCE, '본문');
    h.replies.push(QUESTION(1, 2));
    modalReturns(quizResult);
    const sending = h.controller.sendMessage({ content: '/quiz' });
    await started.promise;
    switchToB(h);
    gate.resolve();
    await sending;

    expect(queryOf(h)).not.toHaveBeenCalled();
    expect(h.state.quizSession).toBeNull();
    expect(h.state.currentConversationId).toBe('conv-B');
    expect(h.state.messages.map((m) => m.content)).toEqual(['B PRIVATE HISTORY']);
    expect((Notice as any).messages.join('\n')).toContain('대화');
  });

  it('/socratic: switching conversations while the source re-check is awaited aborts', async () => {
    const gate = deferred();
    const started = deferred();
    const h = harness({ readGate: () => { started.resolve(); return gate.promise; } });
    h.files.set(SOURCE, '본문');
    h.replies.push('첫 질문');
    modalReturns(socraticResult);
    const sending = h.controller.sendMessage({ content: '/socratic' });
    await started.promise;
    switchToB(h);
    gate.resolve();
    await sending;

    expect(queryOf(h)).not.toHaveBeenCalled();
    expect(h.state.socraticSession).toBeNull();
    expect(h.state.messages.map((m) => m.content)).toEqual(['B PRIVATE HISTORY']);
  });

  it('/socratic saved-record start: switching during the record re-check never opens a fresh conversation or sends', async () => {
    const gate = deferred();
    const started = deferred();
    const h = harness({ readGate: () => { started.resolve(); return gate.promise; } });
    h.files.set(RECORD_PATH, RECORD);
    h.files.set(SOURCE, '본문');
    h.replies.push('첫 질문');
    modalReturns({
      ...socraticResult, sourcePaths: [], sourceFingerprints: {}, entry: 'review',
      recordPaths: [RECORD_PATH], recordFingerprints: { [RECORD_PATH]: sha256(RECORD) },
    });
    const sending = h.controller.sendMessage({ content: '/socratic' });
    await started.promise;
    switchToB(h);
    gate.resolve();
    await sending;

    expect(h.createNew).not.toHaveBeenCalled();
    expect(queryOf(h)).not.toHaveBeenCalled();
    expect(h.state.messages.map((m) => m.content)).toEqual(['B PRIVATE HISTORY']);
  });

  it.each([['/quiz', quizResult], ['/socratic', socraticResult]])('%s: a conversation change while the setup modal is open aborts', async (command, result) => {
    const h = harness();
    h.files.set(SOURCE, '본문');
    h.replies.push('q');
    modalReturns(result, () => switchToB(h));
    await h.controller.sendMessage({ content: command });
    expect(queryOf(h)).not.toHaveBeenCalled();
    expect(h.state.quizSession).toBeNull();
    expect(h.state.socraticSession).toBeNull();
    expect(h.state.messages.map((m) => m.content)).toEqual(['B PRIVATE HISTORY']);
  });
});

describe('live Quiz review does not carry unrelated sidecars', () => {
  const IMAGE = { id: 'img1', name: 'other.png', mediaType: 'image/png', data: 'AAAA', size: 4, source: 'paste' };
  const lastQuery = (h: Harness) => ((h.deps.plugin as any).agentService.query as jest.Mock).mock.calls.at(-1) as unknown[];

  async function finishedQuizWithSidecars() {
    const images: any[] = [];
    const externalContexts: string[] = [];
    const h = harness({ images, externalContexts });
    await runQuiz(h, '### 정답 확인\n\n### 학습 요약 (AI 초안)\n- 요약');
    const final = h.state.messages[h.state.messages.length - 1];
    // Only now does the student put something unrelated in the composer / context selector.
    images.push(IMAGE);
    externalContexts.push('private/other-project.md');
    h.imageManager.clearImages.mockClear();
    return { h, final, images, externalContexts };
  }

  it('positive control: an ordinary message still carries the composer image and external context', async () => {
    const h = harness({ images: [IMAGE], externalContexts: ['private/other-project.md'] });
    h.replies.push('ok');
    await h.controller.sendMessage({ content: '그냥 질문' });
    const [, images, , options] = lastQuery(h) as [string, unknown[], unknown, { externalContextPaths?: string[] }];
    expect(images).toEqual([IMAGE]);
    expect(options.externalContextPaths).toEqual(['private/other-project.md']);
  });

  it('sends the review without the pending image or the current external context, and leaves the composer intact', async () => {
    const { h, final, images } = await finishedQuizWithSidecars();
    h.replies.push('복습 첫 질문');
    expect(await h.controller.startQuizReview(final.id)).toBe(true);

    const [, sentImages, previous, options] = lastQuery(h) as [string, unknown, Array<{ id: string }>, { externalContextPaths?: string[] }];
    expect(sentImages).toBeUndefined();
    expect(options.externalContextPaths).toBeUndefined();
    const reviewUser = h.state.messages.find((m) => m.role === 'user' && m.content.includes('이 Quiz에서'));
    expect(reviewUser?.images).toBeUndefined();
    // The true Quiz transcript still travels.
    expect(previous.map((m) => m.id)).toContain(final.id);
    expect(h.state.socraticSession?.quizReview).toBe(true);
    // The student's pending input is neither consumed nor cleared.
    expect(h.imageManager.clearImages).not.toHaveBeenCalled();
    expect(images).toEqual([IMAGE]);
  });

  it('keeps external contexts out of the later turns of the review as well', async () => {
    const { h, final } = await finishedQuizWithSidecars();
    h.replies.push('복습 첫 질문', '다음 질문');
    await h.controller.startQuizReview(final.id);
    await h.controller.sendMessage({ content: '내 답' });
    const [, , , options] = lastQuery(h) as [string, unknown, unknown, { externalContextPaths?: string[] }];
    expect(options.externalContextPaths).toBeUndefined();
  });
});
