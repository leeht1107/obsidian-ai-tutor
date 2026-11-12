/**
 * Input controller for handling user input and message sending.
 *
 * Manages message sending, queue handling, slash command expansion,
 * instruction mode, and approval dialogs.
 */

import type { Component } from 'obsidian';
import { Notice, TFile } from 'obsidian';

import type { SlashCommandManager } from '../../../core/commands';
import {
  buildQuizContinuationPrompt,
  buildQuizHintPrompt,
  buildSocraticContinuationPrompt,
  buildSocraticPrompt,
  inferSocraticSupportLevel,
  parseQuizDisplayContent,
  type QuizQuestionContext,
  type QuizQuestionStyle,
  shouldEnableQuizWebSearch,
} from '../../../core/learning';
import {
  buildQuizSnapshot,
  buildSocraticSnapshot,
  type CompletedLearningSnapshot,
  readRecordBodies,
  sha256,
  type SnapshotSession,
} from '../../../core/learning/records';
import { resolveEffectivePermissionMode } from '../../../core/providers/providerRegistry';
import { isCommandBlocked } from '../../../core/security/BlocklistChecker';
import { ObsidianRecordFs } from '../../../core/storage/LearningRecordFs';
import type { AskUserQuestionInput, ChatMessage, ImageAttachment } from '../../../core/types';
import { getBashToolBlockedCommands } from '../../../core/types';
import type ObsidianCopilotPlugin from '../../../main';
import {
  ApprovalModal,
  dismissQuizAnswerPanel,
  type FileContextManager,
  type ImageContextManager,
  InstructionModal,
  type InstructionModeManager,
  LearningSetupModal,
  type LearningSetupResult,
  showAskUserQuestionPanel,
  showQuizAnswerPanel,
} from '../../../ui';
import { prependCurrentNote, prependCurrentNoteContent } from '../../../utils/context';
import { type EditorSelectionContext, prependEditorContext } from '../../../utils/editor';
import { appendMarkdownSnippet } from '../../../utils/markdown';
import {
  formatSlashCommandWarnings,
  intersectSlashAllowedTools,
  parseSlashCommandContent,
  resolveSlashAllowedTools,
  slashAllowsInlineBash,
} from '../../../utils/slashCommand';
import { buildEditProposalInstruction } from '../../edit-review/editReview';
import { renderEditReviewCard } from '../../edit-review/EditReviewCard';
import { readLiveNote } from '../../edit-review/liveNote';
import { type MessageRenderer, renderLearningRecordActions, renderQuizReviewButton } from '../rendering/MessageRenderer';
import type { InstructionRefineService } from '../services/InstructionRefineService';
import type { TitleGenerationService } from '../services/TitleGenerationService';
import type { ChatState } from '../state/ChatState';
import type { QueryOptions } from '../state/types';
import type { ConversationController } from './ConversationController';
import type { SelectionController } from './SelectionController';
import type { StreamController } from './StreamController';

const CURRENT_NOTE_ONLY_PATTERNS = [
  /현재\s*노트/u,
  /이\s*노트/u,
  /current\s+note/i,
  /this\s+note/i,
  /summari[sz]e.*note/i,
  /what(?:'s| is).*note/i,
] as const;

function parseMentionedLearningCommand(
  content: string,
  fileContextManager: FileContextManager | null,
): { mode: 'quiz' | 'socratic'; notePath: string } | null {
  const mentions = fileContextManager && typeof fileContextManager.getResolvedMentionPaths === 'function'
    ? fileContextManager.getResolvedMentionPaths(content)
    : [];
  if (mentions.length !== 1) return null;
  const mention = mentions[0];
  const command = (content.slice(0, mention.start) + content.slice(mention.end)).trim();
  if (command === '/quiz') return { mode: 'quiz', notePath: mention.path };
  if (command === '/socratic') return { mode: 'socratic', notePath: mention.path };
  return null;
}

type StreamOutcome = 'completed' | 'interrupted' | 'failed';

/** Dependencies for InputController. */
export interface InputControllerDeps {
  plugin: ObsidianCopilotPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  selectionController: SelectionController;
  conversationController: ConversationController;
  getInputEl: () => HTMLTextAreaElement;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getSlashCommandManager: () => SlashCommandManager | null;
  getWebSearchToggle: () => { isEnabled: () => boolean; setEnabled?: (enabled: boolean) => void } | null;
  getExternalContextSelector: () => { getExternalContexts: () => string[] } | null;
  getInstructionModeManager: () => InstructionModeManager | null;
  getInstructionRefineService: () => InstructionRefineService | null;
  getTitleGenerationService: () => TitleGenerationService | null;
  getComponent: () => Component;
  /**
   * Marks one write-capable action — a slash command's inline bash expanding, or a
   * provider request streaming — as started or settled, so the toolbar can lock the
   * Ask/Agent toggle for as long as anything it already authorized is still running.
   * Backed by a counter on the plugin: pair every `true` with exactly one `finally`
   * that calls `false`, since two such actions can overlap.
   */
  setBashExpansionActive: (active: boolean) => void;
  showSocraticBanner?: (scopeLabel: string, focusText?: string, onHint?: () => void, onStuck?: () => void) => void;
  hideSocraticBanner?: () => void;
  generateId: () => string;
  resetContextMeter: () => void;
}

interface QuizSessionInit {
  totalQuestions: number;
  scopeLabel: string;
  focusText?: string;
  difficulty?: '하' | '중' | '상';
  enableWebSearch?: boolean;
  questionStyle?: QuizQuestionStyle;
  sourceInstruction?: string;
  sourcePaths?: string[];
  sourceFingerprints?: Record<string, string>;
}

interface SocraticSessionInit {
  scopeLabel: string;
  focusText?: string;
  sourceInstruction?: string;
  sourcePaths?: string[];
  sourceFingerprints?: Record<string, string>;
  /** Saved-record entry: a fresh conversation that reads no editor, note or earlier context. */
  recordEntry?: 'new' | 'review' | 'continue';
  enableWebSearch?: boolean;
  /** A Quiz review continues the Quiz's own source instead of starting a new session. */
  quizReview?: boolean;
}

/**
 * InputController handles user input and message sending.
 */

/** Send options of a queued message handed back to the input after a turn's cleanup failed. */
interface RestoredQueuedSend {
  conversationId: string | null;
  content: string;
  editorContext: EditorSelectionContext | null;
  promptPrefix?: string;
}

export class InputController {
  private deps: InputControllerDeps;
  /** True while a finished stream is being finalized and saved: the switch lock is held, but nothing is left to cancel. */
  private finalizingTurn = false;
  private restoredQueuedSend: RestoredQueuedSend | null = null;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
  }

  private dismissActiveQuizAnswerPanel(): void {
    const quizContainerEl = this.deps.getMessagesEl().parentElement;
    if (quizContainerEl) {
      dismissQuizAnswerPanel(quizContainerEl);
    }
  }

  private exitQuizMode(): void {
    this.deps.state.quizSession = null;
    this.dismissActiveQuizAnswerPanel();
  }

  private exitSocraticMode(): void {
    this.deps.state.socraticSession = null;
    this.deps.hideSocraticBanner?.();
  }

  private recordSource(): { fs: ObsidianRecordFs; folder: string } {
    const { plugin } = this.deps;
    return { fs: new ObsidianRecordFs(plugin.app), folder: plugin.settings.learningRecordsFolder };
  }

  /** Quiz 힌트 shortcut (PRD §8.2): asks for one hint without grading or advancing. */
  /** Public: the stored-message quiz row reaches this through the view's delegation. */
  requestQuizHint(): void {
    const { state } = this.deps;
    if (state.isStreaming || !state.quizSession) return;
    void this.sendMessage({ content: '힌트 주세요', quizHintRequest: true });
  }

  /** Resolves false only when the review may be retried, so the caller re-enables its button. */
  async startQuizReview(messageId: string): Promise<boolean> {
    const { state } = this.deps;
    if (state.isStreaming || state.quizSession || state.socraticSession) {
      new Notice('진행 중인 학습이 끝난 뒤 퀴즈 복습을 시작할 수 있습니다.');
      return false;
    }
    const finalTurn = state.messages.find((message) => message.id === messageId && message.quizReviewAvailable);
    if (!finalTurn) {
      new Notice('이 Quiz의 복습은 이미 시작했거나 더 이상 사용할 수 없습니다.');
      return true;
    }
    // A save that is still writing settles before the review starts; a finished save does not block it.
    if (state.currentConversationId
      && this.deps.plugin.getLearningRecordSaveService().isSaving(state.currentConversationId, messageId)) {
      new Notice('학습 기록 저장이 끝난 뒤 복습을 시작해 주세요.');
      return false;
    }
    // Consume first so a switch or summary-only reply cannot reopen it; restore only on failure.
    const conversationId = state.currentConversationId;
    finalTurn.quizReviewAvailable = false;
    void this.deps.conversationController.save(true);
    let outcome: StreamOutcome | undefined;
    try {
      outcome = await this.sendMessage({
      content: '이 Quiz에서 헷갈린 개념을 소크라테스식 질문으로 복습해 주세요. 한 번에 질문 하나만 하고, 이해하면 다음 개념으로 넘어가세요.',
      promptPrefix: buildSocraticPrompt({
        scopeInstruction: finalTurn.quizReviewSourceInstruction ?? 'Use the completed Quiz conversation as source context.',
        supportLevel: 1,
      }),
      socraticSessionInit: {
        scopeLabel: 'Quiz 복습',
        sourceInstruction: finalTurn.quizReviewSourceInstruction,
        // Only a Quiz that required Web keeps it; otherwise the toolbar toggle decides.
        enableWebSearch: finalTurn.quizReviewEnableWebSearch === true ? true : undefined,
        quizReview: true,
        sourcePaths: finalTurn.learningSnapshot?.sourcePaths,
      },
      });
    } finally {
      // Restore only when the review never got going; a started review stays consumed.
      if (outcome !== 'completed') this.restoreQuizReview(conversationId, messageId);
    }
    return outcome === 'completed';
  }

  /** Restores the offer on the Quiz's own conversation, even if the view switched away meanwhile. */
  private restoreQuizReview(conversationId: string | null, messageId: string): void {
    const { plugin, state, conversationController } = this.deps;
    if (state.currentConversationId === conversationId) {
      // Look the turn up again: a switch away and back reloads messages as new objects.
      const turn = state.messages.find((message) => message.id === messageId);
      if (!turn || state.socraticSession?.quizReview) return;
      turn.quizReviewAvailable = true;
      void conversationController.save(true);
      return;
    }
    const stored = conversationId ? plugin.getConversationById(conversationId) : null;
    if (!stored || stored.socraticSession?.quizReview) return;
    if (!stored.messages.some((message) => message.id === messageId)) return;
    const messages = stored.messages.map((message) => (
      message.id === messageId ? { ...message, quizReviewAvailable: true } : message
    ));
    void plugin.updateConversation(stored.id, { messages });
  }

  /** Socratic 힌트/모르겠어요 shortcuts (PRD §9.1): plain STUCK_PATTERNS-recognized text. */
  private sendSocraticShortcut(content: string): void {
    if (!this.deps.state.socraticSession) return;
    void this.sendMessage({ content });
  }

  private getLatestQuizQuestionContext(
    currentQuestion: number,
    totalQuestions: number
  ): QuizQuestionContext | undefined {
    for (let i = this.deps.state.messages.length - 1; i >= 0; i -= 1) {
      const msg = this.deps.state.messages[i];
      if (msg.role !== 'assistant' || !msg.quizQuestion) {
        continue;
      }

      const questionNumber = msg.quizQuestion.current;
      const matchesActiveQuestion = questionNumber === currentQuestion || questionNumber === currentQuestion - 1;
      if (!matchesActiveQuestion || msg.quizQuestion.total !== totalQuestions) {
        continue;
      }

      const questionHeaderPattern = new RegExp(`^##\\s*${questionNumber}\\s*/\\s*${totalQuestions}번 문제`, 'im');
      const textBlock = [...(msg.contentBlocks ?? [])]
        .reverse()
        .find((block): block is { type: 'text'; content: string } =>
          block.type === 'text' && questionHeaderPattern.test(block.content)
        );
      if (!textBlock) {
        return undefined;
      }

      return {
        questionNumber,
        totalQuestions,
        messageId: msg.id,
        questionText: this.extractQuizQuestionBlock(textBlock.content, questionNumber, totalQuestions),
      };
    }

    return undefined;
  }

  private extractQuizQuestionBlock(content: string, questionNumber: number, totalQuestions: number): string {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const headerPattern = new RegExp(`^##\\s*${questionNumber}\\s*/\\s*${totalQuestions}번 문제`, 'i');
    const startIndex = lines.findIndex((line) => headerPattern.test(line.trim()));
    if (startIndex === -1) {
      return content.trim();
    }

    const nextHeaderIndex = lines.findIndex((line, index) =>
      index > startIndex && /^##\s*\d+\s*\/\s*\d+번 문제/i.test(line.trim())
    );
    const questionLines = nextHeaderIndex === -1
      ? lines.slice(startIndex)
      : lines.slice(startIndex, nextHeaderIndex);

    return questionLines.join('\n').trim();
  }

  private inferQuizSessionInit(displayContent?: string): QuizSessionInit | undefined {
    const parsed = parseQuizDisplayContent(displayContent);
    if (!parsed) {
      return undefined;
    }

    return {
      totalQuestions: parsed.totalQuestions,
      scopeLabel: displayContent ?? '/quiz',
      focusText: parsed.focusText,
      difficulty: parsed.difficulty,
      enableWebSearch: shouldEnableQuizWebSearch(parsed.difficulty),
      questionStyle: parsed.questionStyle,
    };
  }

  /**
   * Re-reads what the student approved and compares it with what the setup showed. A source or
   * record that changed after the preview must be confirmed again, never sent silently.
   */
  private async inputsStillMatch(result: LearningSetupResult): Promise<boolean> {
    const { plugin } = this.deps;
    try {
      for (const [path, fingerprint] of Object.entries(result.sourceFingerprints ?? {})) {
        const file = plugin.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || sha256(await plugin.app.vault.read(file)) !== fingerprint) {
          new Notice(`선택한 자료가 시작 직전에 바뀌었습니다: ${path}. 다시 시작해 확인해 주세요.`);
          return false;
        }
      }
      if (result.mode === 'socratic' && result.recordPaths?.length) {
        const bodies = await readRecordBodies(new ObsidianRecordFs(plugin.app), result.recordPaths);
        if (bodies.some((body) => body.fingerprint !== result.recordFingerprints[body.path])) {
          new Notice('선택한 학습 기록이 미리보기 이후 바뀌었습니다. 다시 시작해 확인해 주세요.');
          return false;
        }
      }
    } catch {
      new Notice('선택한 자료나 기록을 다시 읽지 못해 시작하지 않았습니다.');
      return false;
    }
    return true;
  }

  /**
   * A new app conversation and provider session, with the queue, attachments and external
   * context cleared. Only called after the final Start confirmation.
   */
  private async startFreshConversation(): Promise<boolean> {
    const { plugin, state, conversationController } = this.deps;
    if (state.isStreaming) return false;
    this.discardQueuedInput();
    await conversationController.createNew();
    plugin.agentService.resetSession();
    this.deps.getImageContextManager()?.clearImages();
    this.deps.getInputEl().value = '';
    return state.messages.length === 0 && !state.quizSession && !state.socraticSession;
  }

  private stillInConversation(conversationId: string | null): boolean {
    if (this.deps.state.currentConversationId === conversationId) return true;
    new Notice('학습을 시작한 대화에서 다른 대화로 옮겨 시작하지 않았습니다. 다시 시작해 주세요.');
    return false;
  }

  private async sendLearningSetupResult(
    result: LearningSetupResult,
    options: {
      promptPrefix?: string;
      editorContextOverride?: EditorSelectionContext | null;
    },
    /** The conversation the setup was started in; a different one now means the student moved on. */
    initiatingConversationId: string | null = this.deps.state.currentConversationId,
  ) {
    if (!(await this.inputsStillMatch(result)) || !this.stillInConversation(initiatingConversationId)) return;

    const sharedOptions = {
      content: result.prompt,
      displayContentOverride: result.displayContent,
      promptPrefix: options.promptPrefix,
      editorContextOverride: options.editorContextOverride,
    };

    if (result.mode === 'quiz') {
      await this.sendMessage({
        ...sharedOptions,
        quizSessionInit: {
          totalQuestions: result.totalQuestions,
          scopeLabel: result.displayContent,
          focusText: result.focusText,
          difficulty: result.difficulty,
          enableWebSearch: result.enableWebSearch,
          questionStyle: result.questionStyle,
          sourceInstruction: result.sourceInstruction,
          sourcePaths: result.sourcePaths,
          sourceFingerprints: result.sourceFingerprints,
        },
      });
      return;
    }

    if (result.entry) {
      // Saved-record entry (new, review, continue): none of the earlier conversation may leak in.
      if (!(await this.startFreshConversation())) {
        new Notice('새 대화를 시작하지 못했습니다. 진행 중인 응답이 끝난 뒤 다시 시도해 주세요.');
        return;
      }
      sharedOptions.promptPrefix = undefined;
      sharedOptions.editorContextOverride = null;
    }

    await this.sendMessage({
      ...sharedOptions,
      socraticSessionInit: {
        scopeLabel: result.displayContent,
        focusText: result.focusText,
        sourceInstruction: result.sourceInstruction,
        sourcePaths: result.sourcePaths,
        sourceFingerprints: result.sourceFingerprints,
        recordEntry: result.entry,
      },
    });
  }

  async sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    content?: string;
    promptPrefix?: string;
    displayContentOverride?: string;
    quizSessionInit?: QuizSessionInit;
    socraticSessionInit?: SocraticSessionInit;
    /** Sends a non-advancing quiz hint request instead of grading the current answer. */
    quizHintRequest?: boolean;
    /** Prevent a deferred ordinary message from opening a learning setup after queueing. */
    skipLearningCommand?: boolean;
  }): Promise<StreamOutcome | undefined> {
    const { plugin, state, renderer, streamController, selectionController, conversationController } = this.deps;
    const conversationIdAtSend = state.currentConversationId;
    const inputEl = this.deps.getInputEl();
    const imageContextManager = this.deps.getImageContextManager();
    const fileContextManager = this.deps.getFileContextManager();
    const slashCommandManager = this.deps.getSlashCommandManager();

    const contentOverride = options?.content;
    const shouldUseInput = contentOverride === undefined;
    let content = (contentOverride ?? inputEl.value).trim();
    const hasImages = imageContextManager?.hasImages() ?? false;
    if (!content && !hasImages) return;
    const restored = shouldUseInput ? this.takeRestoredQueuedSend(content) : null;
    if (restored) {
      // Resend the restored message the way the queue would have: its own selection and prefix,
      // and no learning-setup detour for text that was already accepted as an ordinary message.
      options = {
        ...options,
        editorContextOverride: options?.editorContextOverride !== undefined
          ? options.editorContextOverride
          : restored.editorContext,
        promptPrefix: options?.promptPrefix ?? restored.promptPrefix,
        skipLearningCommand: true,
      };
    }
    const quizSessionInit = options?.quizSessionInit ?? this.inferQuizSessionInit(options?.displayContentOverride);
    const socraticSessionInit = options?.socraticSessionInit;
    const learningRequest = Boolean(
      quizSessionInit || state.quizSession || socraticSessionInit || state.socraticSession
    );
    const quizRequest = Boolean(quizSessionInit || (!socraticSessionInit && state.quizSession));
    const quizWebSearchEnabled = quizRequest
      ? quizSessionInit?.enableWebSearch
        ?? state.quizSession?.enableWebSearch
        ?? shouldEnableQuizWebSearch(quizSessionInit?.difficulty ?? state.quizSession?.difficulty ?? '중')
      : undefined;
    const mentionedLearningCommand = options?.skipLearningCommand ? null : parseMentionedLearningCommand(
      content,
      fileContextManager,
    );
    const isLearningCommand = !options?.skipLearningCommand && (
      mentionedLearningCommand !== null
      || content === '/quiz' || content.startsWith('/quiz ')
      || content === '/socratic' || content.startsWith('/socratic ')
    );
    // A queued learning start would lose its session setup, so it waits for the user instead.
    if (state.isStreaming && (isLearningCommand || quizSessionInit || socraticSessionInit)) {
      new Notice('현재 응답이 끝난 뒤 학습을 시작해 주세요.');
      return;
    }

    if (!options?.skipLearningCommand
      && (mentionedLearningCommand?.mode === 'quiz' || content === '/quiz' || content.startsWith('/quiz '))) {
      const quizFocusText = mentionedLearningCommand ? '' : content === '/quiz' ? '' : content.slice('/quiz'.length).trim();
      const quizModal = new LearningSetupModal(plugin.app, mentionedLearningCommand?.notePath ?? fileContextManager?.getCurrentNotePath() ?? null, 'quiz', quizFocusText, this.recordSource());
      const learningResult = await quizModal.openAndWait();
      if (!learningResult || !this.stillInConversation(conversationIdAtSend)) {
        return;
      }

      if (shouldUseInput) {
        inputEl.value = '';
      }

      await this.sendLearningSetupResult(learningResult, {
        promptPrefix: options?.promptPrefix,
        editorContextOverride: options?.editorContextOverride,
      }, conversationIdAtSend);
      return;
    }

    if (!options?.skipLearningCommand
      && (mentionedLearningCommand?.mode === 'socratic' || content === '/socratic' || content.startsWith('/socratic '))) {
      const socraticFocusText = mentionedLearningCommand ? '' : content === '/socratic' ? '' : content.slice('/socratic'.length).trim();
      const socraticModal = new LearningSetupModal(plugin.app, mentionedLearningCommand?.notePath ?? fileContextManager?.getCurrentNotePath() ?? null, 'socratic', socraticFocusText, this.recordSource());
      const learningResult = await socraticModal.openAndWait();
      if (!learningResult || !this.stillInConversation(conversationIdAtSend)) {
        return;
      }

      if (shouldUseInput) {
        inputEl.value = '';
      }

      await this.sendLearningSetupResult(learningResult, {
        promptPrefix: options?.promptPrefix,
        editorContextOverride: options?.editorContextOverride,
      }, conversationIdAtSend);
      return;
    }

    // If agent is working, queue the message instead of dropping it
    if (state.isStreaming) {
      const images = hasImages ? [...(imageContextManager?.getAttachedImages() || [])] : undefined;
      const editorContext = selectionController.getContext();
      const promptPrefix = options?.promptPrefix;

      // Append to existing queued message if any
      if (state.queuedMessage) {
        state.queuedMessage.content += '\n\n' + content;
        if (images && images.length > 0) {
          state.queuedMessage.images = [...(state.queuedMessage.images || []), ...images];
        }
        state.queuedMessage.editorContext = editorContext;
        if (promptPrefix) {
          state.queuedMessage.promptPrefix = state.queuedMessage.promptPrefix ?? promptPrefix;
        }
        state.queuedMessage.skipLearningCommand = true;
      } else {
        state.queuedMessage = {
          content,
          images,
          editorContext,
          promptPrefix,
          skipLearningCommand: true,
        };
      }

      if (shouldUseInput) {
        inputEl.value = '';
      }
      imageContextManager?.clearImages();
      this.updateQueueIndicator();
      return;
    }

    if (shouldUseInput) {
      inputEl.value = '';
    }

    if (quizSessionInit) {
      this.exitQuizMode();
      this.exitSocraticMode();
      state.quizSession = {
        totalQuestions: quizSessionInit.totalQuestions,
        currentQuestion: 1,
        scopeLabel: quizSessionInit.scopeLabel,
        focusText: quizSessionInit.focusText,
        difficulty: quizSessionInit.difficulty,
        enableWebSearch: quizSessionInit.enableWebSearch,
        questionStyle: quizSessionInit.questionStyle,
        sourceInstruction: quizSessionInit.sourceInstruction,
        sourcePaths: quizSessionInit.sourcePaths,
        sourceFingerprints: quizSessionInit.sourceFingerprints,
      };
    }

    if (socraticSessionInit) {
      this.exitQuizMode();
      this.exitSocraticMode();
      state.socraticSession = {
        maxDepth: 20,
        currentDepth: 1,
        scopeLabel: socraticSessionInit.scopeLabel,
        focusText: socraticSessionInit.focusText,
        sourceInstruction: socraticSessionInit.sourceInstruction,
        enableWebSearch: socraticSessionInit.enableWebSearch,
        supportLevel: 1,
        isSummaryPhase: false,
        sourcePaths: socraticSessionInit.sourcePaths,
        sourceFingerprints: socraticSessionInit.sourceFingerprints,
        ...(socraticSessionInit.quizReview ? { quizReview: true } : {}),
        ...(socraticSessionInit.recordEntry ? { recordEntry: socraticSessionInit.recordEntry } : {}),
      };
      this.deps.showSocraticBanner?.(
        socraticSessionInit.scopeLabel,
        socraticSessionInit.focusText,
        () => this.sendSocraticShortcut('힌트 주세요'),
        () => this.sendSocraticShortcut('모르겠어요. 조금 더 설명해 주세요.')
      );
    }

    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false; // Allow usage updates for new query
    state.subagentsSpawnedThisStream = 0; // Reset subagent counter for new query

    // Hide welcome message when sending first message
    const welcomeEl = this.deps.getWelcomeEl();
    if (welcomeEl) {
      welcomeEl.style.display = 'none';
    }

    fileContextManager?.startSession();

    // A programmatic Quiz review sends only the Quiz's own transcript: whatever image the student
    // has pending in the composer is theirs for a later message, not part of this review.
    const images = socraticSessionInit?.quizReview ? [] : imageContextManager?.getAttachedImages() || [];
    const imagesForMessage = images.length > 0 ? [...images] : undefined;

    const userMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'user',
      content,
      displayContent: options?.displayContentOverride,
      timestamp: Date.now(),
      images: imagesForMessage,
    };
    if (options?.quizHintRequest) userMsg.quizHint = true;
    // The reply to the final synthesizing question is the one message bound as the student's synthesis.
    if (!socraticSessionInit && state.socraticSession?.isSummaryPhase) userMsg.socraticSynthesis = true;
    if (quizSessionInit && state.quizSession) state.quizSession = { ...state.quizSession, learningSessionId: userMsg.id };
    if (socraticSessionInit && state.socraticSession) state.socraticSession = { ...state.socraticSession, learningSessionId: userMsg.id };
    state.addMessage(userMsg);
    renderer.addMessage(userMsg);

    const assistantMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    state.addMessage(assistantMsg);
    const msgEl = renderer.addMessage(assistantMsg);
    const contentEl = msgEl.querySelector('.ocop-message-content') as HTMLElement;

    state.toolCallElements.clear();
    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = '';
    streamController.showThinkingIndicator(contentEl);

    const currentNotePath = fileContextManager?.getCurrentNotePath() || null;
    // A Quiz review and a saved-record start read only their own source, never the open note.
    const isolatedLearning = Boolean(state.socraticSession?.quizReview || state.socraticSession?.recordEntry);
    const shouldSendCurrentNote = !isolatedLearning
      && (fileContextManager?.shouldSendCurrentNote(currentNotePath) ?? false);
    const rawCurrentNoteScope = this.shouldUseCurrentNoteOnlyScope(content);
    // Agent mode on a note: the CLI runs read-only and proposes a revised note; the student
    // accepts blocks on the review card and the plugin writes only those (edit-review/).
    // Decided before slash expansion, whose inline bash would otherwise write first (spar 02 F7).
    const editReviewIntended = Boolean(shouldSendCurrentNote && currentNotePath
      && this.shouldReviewEdits(currentNotePath, learningRequest));
    let slashTemplateCurrentNoteScope = false;

    // Check for slash command and expand it
    const displayContent = content;
    let queryOptions: QueryOptions | undefined;
    let slashAllowedToolsRequested = false;
    if (content && slashCommandManager) {
      slashCommandManager.setCommands(plugin.settings.slashCommands);
      const detected = slashCommandManager.detectCommand(content);
      if (detected) {
        const cmd = plugin.settings.slashCommands.find(
          c => c.name.toLowerCase() === detected.commandName.toLowerCase()
        );
        if (cmd) {
          const parsedCommand = parseSlashCommandContent(cmd.content);
          const semanticPrompt = typeof slashCommandManager.expandSemanticPrompt === 'function'
            ? slashCommandManager.expandSemanticPrompt(cmd, detected.args)
            : parsedCommand.promptContent;
          slashTemplateCurrentNoteScope = this.shouldUseCurrentNoteOnlyScope(semanticPrompt);
          const parsedAllowedTools = resolveSlashAllowedTools(cmd);
          slashAllowedToolsRequested = parsedAllowedTools !== undefined;
          if (slashAllowedToolsRequested && plugin.settings.selectedProvider !== 'copilot') {
            // Fail before expansion: inline bash and file substitutions are part of expansion
            // and must not run for a command whose tool restriction this provider cannot honor.
            queryOptions = { allowedTools: parsedAllowedTools, model: cmd.model };
          } else {
            this.deps.setBashExpansionActive(true);
          try {
            const result = await slashCommandManager.expandCommand(cmd, detected.args, {
              bash: {
                // ASK mode is read-only: inline bash never executes and never prompts
                // for approval there, it is replaced with the same placeholder used when
                // inline bash is disabled entirely (see SlashCommandManager.executeInlineBash).
                // The raw setting is not enough: a provider still awaiting blanket-write
                // consent (reachable by switching providers while in Agent) must also keep
                // bash read-only, or it runs with full authority while the toggle shows Ask.
                enabled: !learningRequest
                  && !editReviewIntended
                  && slashAllowsInlineBash(parsedAllowedTools)
                  && plugin.settings.enableInlineBash
                  && resolveEffectivePermissionMode(
                    plugin.settings.permissionMode,
                    plugin.settings.selectedProvider,
                    plugin.settings.blanketWriteAcknowledged
                  ) === 'agent',
                shouldBlockCommand: (bashCommand) =>
                  isCommandBlocked(
                    bashCommand,
                    getBashToolBlockedCommands(plugin.settings.blockedCommands),
                    plugin.settings.enableBlocklist
                  ),
              },
            });
            content = result.expandedPrompt;

            if (result.errors.length > 0) {
              new Notice(formatSlashCommandWarnings(result.errors));
            }

            if (result.allowedTools !== undefined || result.model) {
              slashAllowedToolsRequested = result.allowedTools !== undefined;
              queryOptions = {
                allowedTools: result.allowedTools,
                model: result.model,
              };
            }
          } finally {
            this.deps.setBashExpansionActive(false);
          }
          }
        }
      }
    }

    const shouldForceCurrentNoteScope =
      rawCurrentNoteScope || slashTemplateCurrentNoteScope;
    // Headless agy auto-denies the shell tool its model uses to open a file, so in a
    // read-only mode a path-only prompt leaves it unable to answer about the note.
    // Mirrors CopilotBridgeService.effectivePermissionMode: the request-level read-only
    // override (set below for learning sessions) and the unsafe-agent gate both apply.
    const shouldInlineNoteForAgy = plugin.settings.selectedProvider === 'agy'
      && !(plugin.settings.allowUnsafeAgyAgent && resolveEffectivePermissionMode(
        plugin.settings.permissionMode,
        plugin.settings.selectedProvider,
        plugin.settings.blanketWriteAcknowledged,
        Boolean(queryOptions?.readOnly || learningRequest)
      ) === 'agent');
    const currentNoteContentPromise = shouldSendCurrentNote && currentNotePath
      && (shouldForceCurrentNoteScope || shouldInlineNoteForAgy)
      ? this.readCurrentNoteContent(currentNotePath)
      : Promise.resolve<string | null>(null);

    // Only clear images if we consumed user input (not for programmatic content override)
    if (shouldUseInput) {
      imageContextManager?.clearImages();
    }

    const editorContextOverride = options?.editorContextOverride;
    // A Quiz review reads only the Quiz's source, not a selection in an unrelated note.
    const editorContext = editorContextOverride !== undefined
      ? editorContextOverride
      : isolatedLearning ? null : selectionController.getContext();

    // Wrap query in XML tag
    let promptToSend = `<query>\n${content}\n</query>`;
    let currentNoteForMessage: string | undefined;

    // Prepend editor context if available
    if (editorContext) {
      promptToSend = prependEditorContext(promptToSend, editorContext);
    }

    const editReviewBase = editReviewIntended && currentNotePath
      ? await this.readEditReviewBase(currentNotePath)
      : null;
    // A review turn never hands the CLI write access, even when the note could not be read.
    if (editReviewIntended) queryOptions = { ...queryOptions, readOnly: true };

    if (editReviewBase !== null && currentNotePath) {
      // The note body itself is attached after mention rewriting below, so the CLI reads
      // exactly the text the review compares against.
      assistantMsg.editReview = {
        notePath: currentNotePath, base: editReviewBase, request: content, hunks: [], decisions: {}, status: 'awaiting',
      };
      queryOptions = { ...queryOptions, readOnly: true };
      currentNoteForMessage = currentNotePath;
    } else if (shouldSendCurrentNote && currentNotePath) {
      if (shouldForceCurrentNoteScope) {
        const currentNoteContent = await currentNoteContentPromise;
        if (currentNoteContent !== null) {
          promptToSend = prependCurrentNoteContent(promptToSend, currentNotePath, currentNoteContent);
          queryOptions = {
            ...queryOptions,
            allowedTools: intersectSlashAllowedTools(
              queryOptions?.allowedTools,
              ['view', ...(quizWebSearchEnabled ? ['web_search', 'web_fetch'] : [])],
            ),
          };
        } else {
          promptToSend = prependCurrentNote(promptToSend, currentNotePath);
        }
      } else if (shouldInlineNoteForAgy) {
        const currentNoteContent = await currentNoteContentPromise;
        promptToSend = currentNoteContent !== null
          ? prependCurrentNoteContent(promptToSend, currentNotePath, currentNoteContent)
          : prependCurrentNote(promptToSend, currentNotePath);
      } else {
        promptToSend = prependCurrentNote(promptToSend, currentNotePath);
      }
      currentNoteForMessage = currentNotePath;
    }

    userMsg.displayContent = options?.displayContentOverride ?? (displayContent !== content ? displayContent : undefined);
    userMsg.currentNote = currentNoteForMessage;

    if (options?.promptPrefix) {
      promptToSend = `${options.promptPrefix}\n\n${promptToSend}`;
    }

    if (!quizSessionInit && state.quizSession) {
      const quizSession = state.quizSession;
      const questionContext = this.getLatestQuizQuestionContext(
        quizSession.currentQuestion,
        quizSession.totalQuestions
      );
      const quizControl = options?.quizHintRequest
        ? buildQuizHintPrompt({
          sourceInstruction: quizSession.sourceInstruction,
          focusText: quizSession.focusText,
          questionContext,
        })
        : buildQuizContinuationPrompt({
          currentQuestion: quizSession.currentQuestion,
          totalQuestions: quizSession.totalQuestions,
          difficulty: quizSession.difficulty,
          questionStyle: quizSession.questionStyle,
          sourceInstruction: quizSession.sourceInstruction,
          focusText: quizSession.focusText,
          questionContext,
        });
      promptToSend = `${quizControl}

${promptToSend}`;
    }

    let pendingSocraticSupportLevel: ReturnType<typeof inferSocraticSupportLevel> | undefined;
    if (!socraticSessionInit && state.socraticSession) {
      const s = state.socraticSession;
      const supportLevel = inferSocraticSupportLevel(s.supportLevel, content);
      pendingSocraticSupportLevel = supportLevel;
      const socraticControl = buildSocraticContinuationPrompt({
        isSummaryPhase: s.isSummaryPhase,
        sourceInstruction: s.sourceInstruction,
        focusText: s.focusText,
        supportLevel,
      });
      promptToSend = `${socraticControl}

${promptToSend}`;
    }

    const containsMentions = promptToSend.includes('@');

    // Transform context file mentions (e.g., @folder/file.ts) to absolute paths
    if (containsMentions && fileContextManager) {
      promptToSend = fileContextManager.transformContextMentions(promptToSend);
    }

    if (assistantMsg.editReview && editReviewBase !== null) {
      const { notePath } = assistantMsg.editReview;
      promptToSend = `${buildEditProposalInstruction(notePath)}\n\n${prependCurrentNoteContent(promptToSend, notePath, editReviewBase)}`;
    }


    // Add external context paths to query
    const externalContextSelector = this.deps.getExternalContextSelector();
    // External contexts are mutable and were not captured with the Quiz, so a review never reads them.
    const externalContextPaths = state.socraticSession?.quizReview ? undefined : externalContextSelector?.getExternalContexts();
    if (externalContextPaths && externalContextPaths.length > 0) {
      queryOptions = {
        ...queryOptions,
        externalContextPaths,
      };
    }

    // Add web search toggle state
    const webSearchEnabled = this.deps.getWebSearchToggle()?.isEnabled() ?? false;
    const sessionWebSearchEnabled = quizRequest
      ? quizWebSearchEnabled
      : socraticSessionInit?.enableWebSearch ?? state.socraticSession?.enableWebSearch;
    const requestWebSearchEnabled = sessionWebSearchEnabled ?? webSearchEnabled;
    queryOptions = {
      ...queryOptions,
      enableWebSearch: requestWebSearchEnabled,
      readOnly: Boolean(queryOptions?.readOnly || learningRequest),
    };

    // Error rendering can throw too: completion is earned only by a normal return.
    let streamOutcome: StreamOutcome = 'failed';
    let executionSettled = false;
    try {
      if (slashAllowedToolsRequested && plugin.settings.selectedProvider !== 'copilot') {
        streamOutcome = 'failed';
        await streamController.appendText('**Error:** This provider cannot enforce a slash command’s Allowed tools restriction. Use Copilot or remove the restriction before running this command.');
      } else {
        streamOutcome = await this.executeStream(promptToSend, imagesForMessage, assistantMsg, queryOptions, userMsg);
      }
      executionSettled = true;
    } finally {
      // Hold the switch lock until this turn's state is settled and saved: finalizing awaits
      // rendering, and a switch in that gap would apply the cleanup below to another conversation.
      let cleanupSettled = false;
      this.finalizingTurn = true;
      try {
        if (streamOutcome === 'interrupted') {
          await streamController.appendText('\n\n<span class="ocop-interrupted">Interrupted</span> <span class="ocop-interrupted-hint">· What should Copilot do instead?</span>');
        }
        streamController.hideThinkingIndicator();
        state.currentContentEl = null;

        streamController.finalizeCurrentThinkingBlock(assistantMsg);
        await streamController.finalizeCurrentTextBlock(assistantMsg);
        assistantMsg.requestOutcome = streamOutcome;
        if (assistantMsg.editReview) {
          // No proposal (an ordinary answer) or an unfinished turn leaves nothing to review.
          if (assistantMsg.editReview.status === 'awaiting' || streamOutcome !== 'completed') {
            delete assistantMsg.editReview;
          } else if (contentEl) {
            renderEditReviewCard(contentEl, assistantMsg.editReview, {
              app: plugin.app,
              onChange: () => { void conversationController.save(); },
              resend: (request) => { void this.sendMessage({ content: request }); },
              isBusy: () => state.isStreaming,
            });
          }
        }
        if (streamOutcome !== 'completed' && quizRequest) {
          // Keep partial output visible, but don't let replay turn it into an answer target.
          assistantMsg.quizQuestion = null;
        }
        if (streamOutcome === 'completed' && contentEl) {
          streamController.injectChoiceButtonsIfNeeded(contentEl, assistantMsg, (choice) => {
            void this.sendMessage({ content: choice });
          });
        }
        state.activeSubagents.clear();

        let snapshotCandidate: CompletedLearningSnapshot | null = null;
        const finishedQuiz = streamOutcome === 'completed' && Boolean(state.quizSession && !quizSessionInit
          && !options?.quizHintRequest && state.quizSession.currentQuestion >= state.quizSession.totalQuestions);
        if (finishedQuiz && state.quizSession) {
          assistantMsg.quizReviewAvailable = true;
          assistantMsg.quizReviewSourceInstruction = state.quizSession.sourceInstruction;
          assistantMsg.quizReviewEnableWebSearch = state.quizSession.enableWebSearch;
          if (contentEl) renderQuizReviewButton(contentEl, assistantMsg.id);
          // The completion message must never be recovered as a live question by the regex path.
          assistantMsg.quizQuestion = null;
          snapshotCandidate = this.snapshotForQuiz(state.quizSession, assistantMsg.id);
        }

        if (streamOutcome !== 'completed' && quizSessionInit) {
          state.quizSession = null;
        }
        if (streamOutcome !== 'completed' && socraticSessionInit) {
          state.socraticSession = null;
          this.deps.hideSocraticBanner?.();
        }

        if (state.quizSession && !quizSessionInit && streamOutcome === 'completed' && !options?.quizHintRequest) {
          if (state.quizSession.currentQuestion < state.quizSession.totalQuestions) {
            state.quizSession = {
              ...state.quizSession,
              currentQuestion: state.quizSession.currentQuestion + 1,
            };
          } else {
            state.quizSession = null;
          }
        }

        if (state.socraticSession && !socraticSessionInit && streamOutcome === 'completed') {
          const s = state.socraticSession;
          const updatedSession = { ...s, supportLevel: pendingSocraticSupportLevel ?? s.supportLevel };
          if (assistantMsg.socraticTurn?.isSummary) {
            assistantMsg.quizQuestion = null;
            snapshotCandidate = this.snapshotForSocratic(s, assistantMsg.id);
            state.socraticSession = null;
            this.deps.hideSocraticBanner?.();
          } else if (updatedSession.isSummaryPhase) {
            // Waiting for student's final answer — keep state unchanged
            state.socraticSession = updatedSession;
          } else if (updatedSession.currentDepth >= updatedSession.maxDepth) {
            state.socraticSession = { ...updatedSession, isSummaryPhase: true };
          } else {
            state.socraticSession = { ...updatedSession, currentDepth: updatedSession.currentDepth + 1 };
          }
        }

        // A new learning session that actually started retires earlier review offers.
        if (streamOutcome === 'completed' && (quizSessionInit || socraticSessionInit) && !socraticSessionInit?.quizReview) {
          for (const message of state.messages) {
            if (message.id !== assistantMsg.id) message.quizReviewAvailable = false;
          }
          const reviewButtons = this.deps.getMessagesEl().querySelectorAll?.<HTMLButtonElement>('.ocop-quiz-review-btn');
          reviewButtons?.forEach((button) => { button.disabled = true; });
        }

        await conversationController.save(true);
        // Only an acknowledged write exposes a restart-safe draft; a failure leaves plain chat.
        if (snapshotCandidate) await this.attachCompletedSnapshot(assistantMsg, snapshotCandidate, contentEl);
        cleanupSettled = true;
      } finally {
        this.finalizingTurn = false;
        state.isStreaming = false;
        state.cancelRequested = false;
        if (!cleanupSettled || !executionSettled) {
          this.recoverFromTurnCleanupFailure(executionSettled
            ? '응답을 저장하지 못했습니다.'
            : '응답을 처리하지 못했습니다.');
        }
      }

      // Show quiz answer panel if the assistant message has a quiz question
      let skipPostCompletionFollowups = false;
      if (assistantMsg.quizQuestion && streamOutcome === 'completed' && !options?.quizHintRequest) {
        const quizContainerEl = this.deps.getMessagesEl().parentElement;
        if (quizContainerEl) {
          const result = await showQuizAnswerPanel(
            quizContainerEl,
            assistantMsg.quizQuestion,
            () => this.requestQuizHint()
          );
          const isStillCurrentConversation = state.currentConversationId === conversationIdAtSend;
          const isAssistantMessageStillPresent = state.messages.some((msg) => msg.id === assistantMsg.id);
          if (!isStillCurrentConversation || !isAssistantMessageStillPresent) {
            skipPostCompletionFollowups = true;
          } else if ('answer' in result) {
            setTimeout(() => void this.sendMessage({ content: result.answer }), 50);
          }
        }
      }

      if (!skipPostCompletionFollowups && executionSettled) {
        // A failed/interrupted first turn has no trustworthy assistant answer to title,
        // and must not launch a second provider request after the primary one was rejected.
        if (streamOutcome === 'completed') {
          await this.triggerTitleGeneration();
        }

        this.processQueuedMessage();
      }
    }
    return streamOutcome;
  }

  private snapshotSession(
    session: { sourcePaths?: string[]; sourceFingerprints?: Record<string, string>; scopeLabel: string; learningSessionId?: string; totalQuestions?: number },
  ): SnapshotSession | null {
    const conversationId = this.deps.state.currentConversationId;
    if (!conversationId || !session.learningSessionId) return null;
    return {
      conversationId,
      learningSessionId: session.learningSessionId,
      scopeLabel: session.scopeLabel,
      sourcePaths: session.sourcePaths ?? [],
      sourceFingerprints: session.sourceFingerprints,
      totalQuestions: session.totalQuestions,
    };
  }

  private snapshotForQuiz(
    session: NonNullable<ChatState['quizSession']>,
    completionMessageId: string,
  ): CompletedLearningSnapshot | null {
    const snapshotSession = this.snapshotSession({ ...session, totalQuestions: session.totalQuestions });
    if (!snapshotSession) return null;
    return buildQuizSnapshot({ session: snapshotSession, messages: this.deps.state.messages, completionMessageId, now: Date.now() });
  }

  private snapshotForSocratic(
    session: NonNullable<ChatState['socraticSession']>,
    completionMessageId: string,
  ): CompletedLearningSnapshot | null {
    const snapshotSession = this.snapshotSession(session);
    if (!snapshotSession) return null;
    return buildSocraticSnapshot({
      session: snapshotSession,
      messages: this.deps.state.messages,
      completionMessageId,
      origin: session.quizReview ? 'quiz-review' : 'socratic',
      now: Date.now(),
    });
  }

  private async attachCompletedSnapshot(
    assistantMsg: ChatMessage,
    snapshot: CompletedLearningSnapshot,
    contentEl: HTMLElement | null,
  ): Promise<void> {
    const acknowledged = await this.deps.plugin.attachLearningSnapshot(snapshot.conversationId, assistantMsg.id, snapshot);
    if (!acknowledged) {
      new Notice('학습 기록 초안을 안전하게 저장하지 못해 이번에는 기록 저장을 쓸 수 없습니다.');
      return;
    }
    assistantMsg.learningSnapshot = snapshot;
    if (contentEl) renderLearningRecordActions(contentEl, assistantMsg);
  }

  private shouldUseCurrentNoteOnlyScope(content: string): boolean {
    const trimmed = content.trim();
    return CURRENT_NOTE_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
  }

  /**
   * Agent mode on a Markdown note outside learning sessions. A slash command's tool
   * allowlist does not opt out: read-only keeps only its read tools (spar 01 F2).
   */
  private shouldReviewEdits(notePath: string, learningRequest: boolean): boolean {
    const { plugin, state } = this.deps;
    return plugin.settings.permissionMode === 'agent'
      && notePath.toLowerCase().endsWith('.md')
      && !learningRequest
      && !state.quizSession
      && !state.socraticSession;
  }

  /** The note as the student sees it (open editor buffer, else file): the base of an edit review. */
  private readEditReviewBase(notePath: string): Promise<string | null> {
    return readLiveNote(this.deps.plugin.app, notePath);
  }

  private async readCurrentNoteContent(notePath: string): Promise<string | null> {
    const file = this.deps.plugin.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return null;
    }

    try {
      return await this.deps.plugin.app.vault.cachedRead(file);
    } catch {
      return null;
    }
  }

  // ============================================
  // Queue Management
  // ============================================

  /** Updates the queue indicator UI. */
  updateQueueIndicator(): void {
    const { state } = this.deps;
    if (!state.queueIndicatorEl) return;

    if (state.queuedMessage) {
      const rawContent = state.queuedMessage.content.trim();
      const preview = rawContent.length > 40
        ? rawContent.slice(0, 40) + '...'
        : rawContent;
      const hasImages = (state.queuedMessage.images?.length ?? 0) > 0;
      let display = preview;

      if (hasImages) {
        display = display ? `${display} [images]` : '[images]';
      }

      state.queueIndicatorEl.setText(`⌙ Queued: ${display}`);
      state.queueIndicatorEl.style.display = 'block';
    } else {
      state.queueIndicatorEl.style.display = 'none';
    }
  }

  /** A conversation change: drops the queue and a restored message's send options with it. */
  discardQueuedInput(): void {
    this.restoredQueuedSend = null;
    this.clearQueuedMessage();
  }

  /** Clears the queued message. */
  clearQueuedMessage(): void {
    const { state } = this.deps;
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  /**
   * A turn's execution or cleanup threw, so the queued message must not auto-send.
   * Hands the queued message back to the input instead of leaving it stranded: left queued,
   * it would fire after some later, unrelated turn.
   */
  private recoverFromTurnCleanupFailure(failureMessage = '응답을 저장하지 못했습니다.'): void {
    const { state } = this.deps;
    const queued = state.queuedMessage;
    if (!queued) {
      new Notice(failureMessage);
      return;
    }
    // Take it off the queue first: a partial restore must not leave the same message both
    // in the input and queued, or sending the input would later send it a second time.
    this.clearQueuedMessage();
    this.restoredQueuedSend = {
      conversationId: state.currentConversationId,
      content: queued.content.trim(),
      editorContext: queued.editorContext,
      promptPrefix: queued.promptPrefix,
    };
    // Runs inside a finally that is already propagating the cleanup error: never replace it.
    try {
      const inputEl = this.deps.getInputEl();
      inputEl.value = inputEl.value ? `${queued.content}\n\n${inputEl.value}` : queued.content;
      if (queued.images && queued.images.length > 0) {
        const imageContextManager = this.deps.getImageContextManager();
        if (imageContextManager) {
          // Keep images attached to a new draft meanwhile; setImages replaces the whole set.
          const queuedIds = new Set(queued.images.map((image) => image.id));
          const drafted = imageContextManager.getAttachedImages().filter((image) => !queuedIds.has(image.id));
          imageContextManager.setImages([...queued.images, ...drafted]);
        }
      }
      new Notice(`${failureMessage} 대기 중이던 메시지를 입력창으로 되돌렸습니다.`);
    } catch (error) {
      console.error('[ObsidianCopilot] Failed to restore the queued message:', error);
      new Notice(`${failureMessage} 대기 중이던 메시지를 입력창으로 모두 되돌리지 못했으니 확인해 주세요.`);
    }
  }

  /**
   * Claims the restored queued message's send options if the input still carries its text
   * in the same conversation. Any send from the input consumes the record either way.
   */
  private takeRestoredQueuedSend(content: string): RestoredQueuedSend | null {
    const restored = this.restoredQueuedSend;
    this.restoredQueuedSend = null;
    if (!restored || restored.conversationId !== this.deps.state.currentConversationId) return null;
    return content.includes(restored.content) ? restored : null;
  }

  /** Processes the queued message. */
  private processQueuedMessage(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const { content, images, editorContext, promptPrefix, skipLearningCommand } = state.queuedMessage;
    state.queuedMessage = null;
    this.updateQueueIndicator();

    const inputEl = this.deps.getInputEl();
    inputEl.value = content;
    if (images && images.length > 0) {
      this.deps.getImageContextManager()?.setImages(images);
    }

    setTimeout(() => this.sendMessage({ editorContextOverride: editorContext, promptPrefix, skipLearningCommand }), 0);
  }

  // ============================================
  // Title Generation
  // ============================================

  /**
   * Triggers AI title generation after first exchange.
   * Handles setting fallback title, firing async generation, and updating UI.
   */
  private async triggerTitleGeneration(): Promise<void> {
    const { plugin, state, conversationController } = this.deps;

    if (state.messages.length !== 2 || !state.currentConversationId) {
      return;
    }

    // Find first user and assistant messages by role (not by index)
    const firstUserMsg = state.messages.find(m => m.role === 'user');
    const firstAssistantMsg = state.messages.find(m => m.role === 'assistant');

    if (!firstUserMsg || !firstAssistantMsg) {
      return;
    }

    const userContent = firstUserMsg.displayContent || firstUserMsg.content;

    // Extract text from assistant response
    const assistantText = firstAssistantMsg.content ||
      firstAssistantMsg.contentBlocks
        ?.filter((b): b is { type: 'text'; content: string } => b.type === 'text')
        .map(b => b.content)
        .join('\n') || '';

    // Set immediate fallback title
    const fallbackTitle = conversationController.generateFallbackTitle(userContent);
    await plugin.renameConversation(state.currentConversationId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }
    // Agy cannot technically enforce Web-off. Auto-title is non-essential, so keep
    // the local fallback title instead of issuing a background request with weaker privacy.
    if (plugin.settings.selectedProvider === 'agy') {
      return;
    }

    // Fire async AI title generation only if service and content available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService || !assistantText) {
      // No titleService or no assistantText, just keep the fallback title with no status
      return;
    }

    // Mark as pending only when we're actually starting generation
    await plugin.updateConversation(state.currentConversationId, { titleGenerationStatus: 'pending' });
    conversationController.updateHistoryDropdown();

    const convId = state.currentConversationId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    titleService.generateTitle(
      convId,
      userContent,
      assistantText,
      async (conversationId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = plugin.getConversationById(conversationId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches fallback)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(conversationId, result.title);
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep fallback title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: undefined });
        }
        conversationController.updateHistoryDropdown();
      }
    ).catch((error) => {
      // Log unexpected errors (callback errors are already handled by safeCallback)
      console.error('[InputController] Title generation failed:', error instanceof Error ? error.message : error);
      new Notice('제목 생성 실패');
    });
  }

  // ============================================
  // Streaming Control
  // ============================================

  /**
   * Runs the streaming loop for a query.
    * Errors are caught and displayed inline.
   * @returns whether the stream completed, was interrupted, or failed.
   */
  private async executeStream(
    prompt: string,
    images: ImageAttachment[] | undefined,
    assistantMsg: ChatMessage,
    queryOptions: QueryOptions | undefined,
    userMsg?: ChatMessage,
  ): Promise<StreamOutcome> {
    const { plugin, state, streamController } = this.deps;
    let outcome: StreamOutcome = 'completed';
    // The turn now in flight is already in `state.messages` (the student sees it), but
    // `prompt` IS that turn — expanded with slash commands, editor selection and any
    // quiz/socratic control text. Replaying both sends the question twice, in two
    // different versions. Drop the in-flight pair by id: a positional slice would take
    // whatever happens to sit at the end, and getting that boundary wrong deletes the
    // conversation rather than a duplicate.
    const inFlightIds = new Set([assistantMsg.id, ...(userMsg ? [userMsg.id] : [])]);
    const previousMessages = state.messages.filter(msg => !inFlightIds.has(msg.id));
    // A running provider request can still write for as long as it streams — the CLI's
    // argv already captured the mode it was authorized under, same as inline bash — so
    // it shares the same busy signal the toggle reads. `finally` covers the interrupted
    // (stop button) path too, since breaking out of the loop below still runs it.
    this.deps.setBashExpansionActive(true);
    try {
      for await (const chunk of plugin.agentService.query(prompt, images, previousMessages, queryOptions)) {
        if (state.cancelRequested) {
          outcome = 'interrupted';
          break;
        }
        if (chunk.type === 'error') {
          outcome = 'failed';
          await streamController.handleStreamChunk(chunk, assistantMsg);
          break;
        }
        await streamController.handleStreamChunk(chunk, assistantMsg);
      }
    } catch (error) {
      outcome = 'failed';
      console.error('[Copilot] Stream error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await streamController.appendText(`\n\n**Error:** ${errorMsg}`);
    } finally {
      this.deps.setBashExpansionActive(false);
    }
    return outcome;
  }

  /** Cancels the current streaming operation. */
  cancelStreaming(): void {
    const { plugin, state, streamController } = this.deps;
    // While finalizing, the reply is already complete: cancelling would only drop the queue.
    if (!state.isStreaming || this.finalizingTurn) return;
    state.cancelRequested = true;
    this.clearQueuedMessage();
    plugin.agentService.cancel();
    streamController.hideThinkingIndicator();
  }

  // ============================================
  // Instruction Mode
  // ============================================

  /** Handles instruction mode submission. */
  async handleInstructionSubmit(rawInstruction: string): Promise<void> {
    const { plugin } = this.deps;
    const instructionRefineService = this.deps.getInstructionRefineService();
    const instructionModeManager = this.deps.getInstructionModeManager();

    if (!instructionRefineService) return;

    const existingPrompt = plugin.settings.systemPrompt;
    let modal: InstructionModal | null = null;
    let wasCancelled = false;

    try {
      modal = new InstructionModal(
        plugin.app,
        rawInstruction,
        {
          onAccept: async (finalInstruction) => {
            const currentPrompt = plugin.settings.systemPrompt;
            plugin.settings.systemPrompt = appendMarkdownSnippet(currentPrompt, finalInstruction);
            await plugin.saveSettings();

            new Notice('Instruction added to custom system prompt');
            instructionModeManager?.clear();
          },
          onReject: () => {
            wasCancelled = true;
            instructionRefineService.cancel();
            instructionModeManager?.clear();
          },
          onClarificationSubmit: async (response) => {
            const result = await instructionRefineService.continueConversation(response);

            if (wasCancelled) {
              return;
            }

            if (!result.success) {
              if (result.error === 'Cancelled') {
                return;
              }
              new Notice(result.error || 'Failed to process response');
              modal?.showError(result.error || 'Failed to process response');
              return;
            }

            if (result.clarification) {
              modal?.showClarification(result.clarification);
            } else if (result.refinedInstruction) {
              modal?.showConfirmation(result.refinedInstruction);
            }
          }
        }
      );
      modal.open();

      instructionRefineService.resetConversation();
      const result = await instructionRefineService.refineInstruction(
        rawInstruction,
        existingPrompt
      );

      if (wasCancelled) {
        return;
      }

      if (!result.success) {
        if (result.error === 'Cancelled') {
          instructionModeManager?.clear();
          return;
        }
        new Notice(result.error || 'Failed to refine instruction');
        modal.showError(result.error || 'Failed to refine instruction');
        instructionModeManager?.clear();
        return;
      }

      if (result.clarification) {
        modal.showClarification(result.clarification);
      } else if (result.refinedInstruction) {
        modal.showConfirmation(result.refinedInstruction);
      } else {
        new Notice('No instruction received');
        modal.showError('No instruction received');
        instructionModeManager?.clear();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Error: ${errorMsg}`);
      modal?.showError(errorMsg);
      instructionModeManager?.clear();
    }
  }

  // ============================================
  // Approval Dialogs
  // ============================================

  /** Handles tool approval requests. */
  async handleApprovalRequest(
    toolName: string,
    input: Record<string, unknown>,
    description: string
  ): Promise<'allow' | 'allow-always' | 'deny' | 'cancel'> {
    const { plugin } = this.deps;
    return new Promise((resolve) => {
      const modal = new ApprovalModal(plugin.app, toolName, input, description, resolve);
      modal.open();
    });
  }

  /** Handles AskUserQuestion tool calls by showing a floating panel. */
  async handleAskUserQuestion(input: AskUserQuestionInput): Promise<Record<string, string | string[]> | null> {
    const { plugin } = this.deps;

    // Get the container element (the ObsidianCode view container)
    const messagesEl = this.deps.getMessagesEl();
    const containerEl = messagesEl.parentElement;
    if (!containerEl) {
      return null;
    }

    return showAskUserQuestionPanel(plugin.app, containerEl, input);
  }
}
