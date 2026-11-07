import type { App } from 'obsidian';
import { Modal, Notice, Setting, TFile } from 'obsidian';

import {
  buildQuizDisplayContent,
  buildQuizPrompt,
  buildSocraticDisplayContent,
  buildSocraticPrompt,
  getBasename,
  getFolderNotePaths,
  getSubjectRoot,
  type LearningScope,
  type QuizDifficulty,
  type QuizQuestionStyle,
  shouldEnableQuizWebSearch,
  stripFrontmatter,
  summarizeFolder,
  summarizeSelectedNotes,
  withPreparationGuidance,
} from '../../core/learning';
import {
  buildRecordContext,
  canContinueRecord,
  discoverRecords,
  escapeRecordText,
  type LearningRecordBody,
  type LearningRecordSummary,
  MAX_SELECTED_RECORD_BYTES,
  readRecordBodies,
  readRecordSummary,
  RecordBudgetError,
  type RecordEntry,
  type RecordFs,
  REFERENCE_ONLY_INSTRUCTION,
  sha256,
  sortByRelevance,
  totalRecordBytes,
} from '../../core/learning/records';

const EMPTY_NOTE_READ_CONCURRENCY = 16;
/** Preview bounds: what is drawn is capped, what is dispatched is not. */
const PREVIEW_EXCERPT_CHARS = 1500;
const PREVIEW_EXCERPT_NOTES = 20;

interface SourceExcerpt {
  path: string;
  /** First characters of the note exactly as read at Start (same read as its fingerprint). */
  text: string;
  /** Length of the whole note, so a cut can be disclosed. */
  chars: number;
}

function excerptOf(text: string): string {
  let cut = text.slice(0, PREVIEW_EXCERPT_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  if (cut.length < text.length && last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

export type LearningSetupMode = 'quiz' | 'socratic';
/** Where a Socratic conversation starts: fresh course materials OR a review of past records, never both. */
export type StartingSource = 'materials' | 'records';

export interface QuizSetupResult {
  mode: 'quiz';
  prompt: string;
  displayContent: string;
  totalQuestions: number;
  difficulty: QuizDifficulty;
  questionStyle: QuizQuestionStyle;
  sourceInstruction: string;
  focusText?: string;
  /** Web search policy for this quiz difficulty. */
  enableWebSearch: boolean;
  /** False when no selected note has content to learn from. */
  hasSourceNotes: boolean;
  /** Typed paths of the approved course materials. */
  sourcePaths: string[];
  /** SHA-256 of each source as read at Start, re-checked right before dispatch. */
  sourceFingerprints: Record<string, string>;
}

export interface SocraticSetupResult {
  mode: 'socratic';
  prompt: string;
  displayContent: string;
  sourceInstruction: string;
  focusText?: string;
  hasSourceNotes: boolean;
  sourcePaths: string[];
  sourceFingerprints: Record<string, string>;
  /** Saved-record entry; set for every Socratic start with a record source, so the start is a fresh conversation. */
  entry?: RecordEntry;
  recordPaths: string[];
  /** Fingerprints of the record files the prompt was built from. */
  recordFingerprints: Record<string, string>;
  /** No verified course material: self-explanation only. */
  referenceOnly: boolean;
}

export type LearningSetupResult = QuizSetupResult | SocraticSetupResult;

const NO_EVIDENCE = 'No eligible course notes selected.';

export class LearningSetupModal extends Modal {
  private resolvePromise: ((result: LearningSetupResult | null) => void) | null = null;
  private mode: LearningSetupMode;
  private learningScope: LearningScope = 'current-note';
  private selectedNotePaths = new Set<string>();
  private selectedFolderPaths = new Set<string>();
  private questionCount = '5';
  private difficulty: QuizDifficulty = '중';
  private questionStyle: QuizQuestionStyle = 'material';
  private focusText: string;
  private useFullVault = false;
  /** Notes found empty at Start; they count as no evidence. */
  private emptyNotePaths = new Set<string>();
  private starting = false;
  private records: LearningRecordSummary[] = [];
  private selectedRecordPaths = new Set<string>();
  private startSource: StartingSource = 'materials';
  private entry: RecordEntry = 'new';
  private recordNotice = '';
  /** Confirmation step shown before a saved-record start is dispatched. */
  private pendingStart: { result: SocraticSetupResult; bodies: LearningRecordBody[]; excerpts: SourceExcerpt[] } | null = null;
  private sourceFingerprints = new Map<string, string>();
  private sourceExcerpts = new Map<string, SourceExcerpt>();

  constructor(
    app: App,
    private readonly activeFilePath: string | null,
    initialMode: LearningSetupMode,
    initialFocusText = '',
    private readonly recordSource: { fs: RecordFs; folder: string } | null = null,
  ) {
    super(app);
    this.mode = initialMode;
    this.focusText = initialFocusText.trim();
    if (!activeFilePath) {
      this.learningScope = 'note';
    }
  }

  onOpen() {
    this.setTitle('학습 시작');
    this.modalEl.addClass('ocop-slash-modal');
    this.modalEl.addClass('ocop-learning-setup-modal');
    this.renderContent();
    void this.loadRecords();
  }

  /** Local listing only: no provider call, no record content leaves the machine. */
  private async loadRecords(): Promise<void> {
    if (!this.recordSource) return;
    try {
      this.records = (await discoverRecords(this.recordSource.fs, this.recordSource.folder)).records;
    } catch {
      this.records = [];
    }
    this.renderContent();
  }

  private renderContent() {
    this.contentEl.empty();
    if (this.pendingStart) {
      this.renderStartPreview(this.pendingStart.result, this.pendingStart.bodies, this.pendingStart.excerpts);
      return;
    }

    const tabsEl = this.contentEl.createDiv({
      cls: 'ocop-learning-setup-tabs',
      attr: { role: 'tablist', 'aria-label': '학습 방식' },
    });
    this.addModeTab(tabsEl, 'quiz', '퀴즈');
    this.addModeTab(tabsEl, 'socratic', '소크라테스식 대화');

    const introEl = this.contentEl.createDiv({ cls: 'ocop-learning-setup-intro' });
    introEl.createEl('p', {
      text: this.mode === 'quiz'
        ? '자료를 바탕으로 확인하고, 배운 개념을 새 상황에 적용해 봅니다.'
        : '질문과 대화로 자료 속 개념을 이해합니다. 선수과목 기초나 자료 설명이 부족한 부분은 쉬운 예시로 보충해요.',
    });

    const allNotes = this.app.vault.getMarkdownFiles().map((file) => file.path).sort();
    const subjectRoot = getSubjectRoot(this.activeFilePath);
    const scopedNotes = subjectRoot
      ? allNotes.filter((notePath) => notePath === subjectRoot || notePath.startsWith(`${subjectRoot}/`))
      : allNotes;
    const candidateNotes = this.useFullVault ? allNotes : scopedNotes;
    const allFolders = Array.from(new Set(candidateNotes
      .map((notePath) => notePath.includes('/') ? notePath.split('/').slice(0, -1).join('/') : '')
      .filter(Boolean))).sort();

    if (this.selectedNotePaths.size === 0 && this.activeFilePath) {
      this.selectedNotePaths.add(this.activeFilePath);
    } else if (this.selectedNotePaths.size === 0 && candidateNotes.length > 0) {
      this.selectedNotePaths.add(candidateNotes[0]);
    }
    if (this.selectedFolderPaths.size === 0 && allFolders.length > 0) {
      this.selectedFolderPaths.add(allFolders[0]);
    }

    // Socratic: one starting source (materials OR past records) is chosen first and only its picker is shown.
    const contextEl = this.mode === 'socratic'
      ? this.contentEl.createDiv({ cls: 'ocop-learning-context' })
      : this.contentEl;
    if (this.mode === 'socratic') this.renderContextIntro(contextEl);
    const showMaterials = this.mode === 'quiz' || !this.isRecordsSource();

    let summaryEl: HTMLElement | null = null;
    const updateSummary = () => summaryEl?.setText(this.summaryText());

    const detailsEl = contextEl.createDiv();
    const renderDetails = () => {
      detailsEl.empty();
      if (subjectRoot) {
        new Setting(detailsEl)
          .setName('범위 선택')
          .setDesc(this.useFullVault ? '보관함 전체에서 노트를 찾습니다.' : `${subjectRoot} 아래의 노트를 표시합니다.`)
          .addToggle((toggle) => {
            toggle.setValue(this.useFullVault).onChange((value) => {
              this.useFullVault = value;
              this.selectedNotePaths.clear();
              this.selectedFolderPaths.clear();
              this.renderContent();
            });
          });
      }

      if (this.learningScope === 'note') {
        detailsEl.createDiv({ cls: 'setting-item-description', text: '노트를 하나 이상 선택하세요.' });
        const noteListEl = detailsEl.createDiv({ cls: 'ocop-quiz-note-list' });
        for (const notePath of candidateNotes) {
          const noteItem = noteListEl.createDiv({ cls: 'ocop-quiz-note-item' });
          const checkbox = noteItem.createEl('input', { attr: { type: 'checkbox' } });
          checkbox.checked = this.selectedNotePaths.has(notePath);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              this.selectedNotePaths.add(notePath);
            } else if (this.selectedNotePaths.size > 1) {
              this.selectedNotePaths.delete(notePath);
            } else {
              checkbox.checked = true;
            }
            noteCountEl.setText(`현재 선택: ${this.selectedNotePaths.size}개 노트`);
            updateSummary();
          });
          noteItem.createSpan({ text: notePath });
        }
        const noteCountEl = detailsEl.createDiv({
          cls: 'setting-item-description',
          text: `현재 선택: ${this.selectedNotePaths.size}개 노트`,
        });
      }

      if (this.learningScope === 'folder') {
        detailsEl.createDiv({ cls: 'setting-item-description', text: '폴더를 하나 이상 선택하세요.' });
        const folderListEl = detailsEl.createDiv({ cls: 'ocop-quiz-note-list' });
        for (const folderPath of allFolders) {
          const folderItem = folderListEl.createDiv({ cls: 'ocop-quiz-note-item' });
          const checkbox = folderItem.createEl('input', { attr: { type: 'checkbox' } });
          checkbox.checked = this.selectedFolderPaths.has(folderPath);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              this.selectedFolderPaths.add(folderPath);
            } else if (this.selectedFolderPaths.size > 1) {
              this.selectedFolderPaths.delete(folderPath);
            } else {
              checkbox.checked = true;
            }
            renderDetails();
          });
          folderItem.createSpan({ text: folderPath });
        }
        const folderNoteCount = candidateNotes.filter((notePath) =>
          Array.from(this.selectedFolderPaths).some((folderPath) => notePath.startsWith(`${folderPath}/`) || notePath === folderPath)
        ).length;
        detailsEl.createDiv({
          cls: 'setting-item-description',
          text: `현재 선택: 폴더 ${this.selectedFolderPaths.size}개 · 포함 노트 ${folderNoteCount}개`,
        });
      }
      updateSummary();
    };

    if (showMaterials) {
      new Setting(contextEl)
        .setName('학습 자료')
        .setDesc('사실과 개념의 근거가 되는 노트를 고릅니다. 준비 방법을 적은 노트(Brief·개요 등)를 함께 고르면 그 지시에 맞춰 진행합니다.')
        .addDropdown((dropdown) => {
          if (this.activeFilePath) {
            dropdown.addOption('current-note', '현재 노트');
          }
          dropdown.addOption('note', '노트 선택');
          dropdown.addOption('folder', '폴더 선택');
          dropdown.setValue(this.learningScope).onChange((value: LearningScope) => {
            this.learningScope = value;
            renderDetails();
          });
        });
      renderDetails();
    }

    if (this.mode === 'quiz') {
      this.renderQuizSettings();
    } else {
      if (!showMaterials) this.renderRecordSection(contextEl);
      // The generic note sits below the selectors so it never separates materials from records.
      const supportEl = this.contentEl.createDiv({ cls: 'ocop-learning-prerequisite-note' });
      supportEl.createEl('strong', { text: '막히는 개념은 예시로 풀어봐요' });
      supportEl.createEl('p', {
        text: '선수 지식이 비어 있거나 자료의 설명이 부족하면, 이해에 필요한 만큼 쉬운 예시로 설명한 뒤 학습 주제와 연결합니다.',
      });
    }

    new Setting(this.contentEl)
      .setName('집중할 주제 (선택)')
      .setDesc('예: 정규화, 조건부확률, 신뢰구간')
      .addText((text) => {
        text
          .setPlaceholder('비우면 선택한 범위 전체에서 시작합니다')
          .setValue(this.focusText)
          .onChange((value) => {
            this.focusText = value.trim();
          });
      });

    if (this.mode === 'socratic') {
      summaryEl = this.contentEl.createDiv({ cls: 'ocop-learning-summary', text: this.summaryText() });
    }

    const buttonsEl = this.contentEl.createDiv({ cls: 'ocop-setup-modal-buttons' });
    const cancelBtn = buttonsEl.createEl('button', { text: '취소', cls: 'ocop-cancel-btn' });
    cancelBtn.addEventListener('click', () => this.finish(null));
    const actionLabel = this.mode === 'quiz' ? '퀴즈 시작' : '대화 시작';
    const startBtn = buttonsEl.createEl('button', { text: actionLabel, cls: 'ocop-save-btn mod-cta' });
    startBtn.addEventListener('click', () => { void this.start(); });
  }

  private async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      if (this.isRecordsSource()) {
        // Records start never touches course notes: the open note is not read and no source path is sent.
        await this.startFromRecords();
        return;
      }
      this.emptyNotePaths.clear();
      this.sourceFingerprints.clear();
      this.sourceExcerpts.clear();
      const { paths } = this.buildScope();
      // Empty notes are no evidence: drop them, and refuse a selection with no content left.
      for (const path of await this.findEmptyNotes(paths)) this.emptyNotePaths.add(path);
      // The selection stays editable during the check; never submit notes that were not checked.
      const checked = new Set(paths);
      if (this.buildScope().paths.some((path) => !checked.has(path))) {
        new Notice('자료를 확인하는 동안 선택이 바뀌었습니다. 다시 시작해 주세요.');
        return;
      }
      const result = this.buildResult();
      if (!this.canStart(result)) return;
      if (result.mode === 'socratic') {
        // Socratic confirms what will be read before anything is dispatched; Quiz is unchanged.
        const excerpts = result.sourcePaths.flatMap((path) => this.sourceExcerpts.get(path) ?? []);
        this.pendingStart = { result, bodies: [], excerpts };
        this.renderContent();
        return;
      }
      this.finish(result);
    } finally {
      this.starting = false;
    }
  }

  /** Review or continue: read the chosen records fresh, check the 64KiB budget, then ask to confirm. */
  private async startFromRecords(): Promise<void> {
    const selected = this.selectedRecords();
    if (selected.length === 0) {
      new Notice('복습할 학습 기록을 하나 이상 선택하세요.');
      return;
    }
    let bodies: LearningRecordBody[];
    try {
      bodies = await readRecordBodies(this.recordSource!.fs, selected.map((record) => record.path));
      buildRecordContext(this.entry, bodies);
      // Availability is decided by the fresh read, not by the listing shown earlier.
      if (this.entry === 'continue' && !bodies.some((body) => body.canContinue)) {
        new Notice('선택한 기록 중 남은 질문이 있는 기록이 없습니다.');
        return;
      }
    } catch (error) {
      new Notice(error instanceof RecordBudgetError || error instanceof Error ? error.message : '기록을 읽지 못했습니다.');
      return;
    }
    const result = this.buildResult(bodies);
    if (result.mode !== 'socratic' || !this.canStart(result)) return;
    this.pendingStart = { result, bodies, excerpts: [] };
    this.renderContent();
  }

  private isRecordsSource(): boolean {
    return this.mode === 'socratic' && this.startSource === 'records' && this.recordSource !== null;
  }

  private selectedRecords(): LearningRecordSummary[] {
    return this.records.filter((record) => this.selectedRecordPaths.has(record.path));
  }

  /** Notes with no content beyond frontmatter; an unreadable note counts as empty. */
  private async findEmptyNotes(paths: string[]): Promise<string[]> {
    const isEmpty = async (path: string): Promise<boolean> => {
      const file = this.app.vault.getAbstractFileByPath?.(path);
      if (!(file instanceof TFile)) return true;
      try {
        const text = await this.app.vault.cachedRead(file);
        this.sourceFingerprints.set(path, sha256(text));
        this.sourceExcerpts.set(path, { path, text: excerptOf(text), chars: text.length });
        return !stripFrontmatter(text).trim();
      } catch {
        return true;
      }
    };
    // A folder or full-vault scope can hold thousands of notes; read a bounded batch at a time.
    const empty: string[] = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < paths.length) {
        const path = paths[next++];
        if (await isEmpty(path)) empty.push(path);
      }
    };
    await Promise.all(Array.from({ length: Math.min(EMPTY_NOTE_READ_CONCURRENCY, paths.length) }, worker));
    return empty;
  }

  private canStart(result: LearningSetupResult): boolean {
    // Saved records may be reviewed without course material, labelled reference-only.
    if (result.mode === 'socratic' && result.referenceOnly) return true;
    if (!result.hasSourceNotes) {
      new Notice('학습에 쓸 노트가 없습니다. 내용이 있는 노트를 선택하세요.');
      return false;
    }
    return true;
  }

  private addModeTab(containerEl: HTMLElement, mode: LearningSetupMode, label: string) {
    const selected = this.mode === mode;
    const button = containerEl.createEl('button', {
      text: label,
      cls: selected ? 'ocop-learning-setup-tab is-active' : 'ocop-learning-setup-tab',
      attr: {
        type: 'button',
        role: 'tab',
        'aria-selected': String(selected),
        tabindex: selected ? '0' : '-1',
      },
    });
    button.addEventListener('click', () => {
      if (this.mode !== mode) {
        this.mode = mode;
        this.renderContent();
      }
    });
  }

  private renderQuizSettings() {
    new Setting(this.contentEl)
      .setName('문제 수')
      .addDropdown((dropdown) => {
        for (const count of ['3', '4', '5', '6', '7', '8', '9', '10']) {
          dropdown.addOption(count, `${count}문제`);
        }
        dropdown.setValue(this.questionCount).onChange((value) => {
          this.questionCount = value;
        });
      });

    new Setting(this.contentEl)
      .setName('난이도')
      .addDropdown((dropdown) => {
        dropdown.addOption('하', '하 — 기본 개념 확인');
        dropdown.addOption('중', '중 — 종합 이해 (기본값)');
        dropdown.addOption('상', '상 — 심화 (웹 검색 자동 활성화)');
        dropdown.setValue(this.difficulty).onChange((value: QuizDifficulty) => {
          this.difficulty = value;
        });
      });

    const styleEl = this.contentEl.createDiv({ cls: 'ocop-learning-question-styles' });
    styleEl.setAttribute('role', 'radiogroup');
    styleEl.setAttribute('aria-label', '질문 방식');
    this.addQuestionStyleOption(styleEl, 'material', '자료 중심', '선택한 자료의 개념과 설명을 확인합니다.');
    this.addQuestionStyleOption(styleEl, 'application', '자료 + 연계 응용', '배운 개념을 새로운 상황에 적용합니다.');
  }

  private addQuestionStyleOption(
    containerEl: HTMLElement,
    style: QuizQuestionStyle,
    title: string,
    description: string,
  ) {
    const selected = this.questionStyle === style;
    const option = containerEl.createEl('button', {
      cls: selected ? 'ocop-learning-question-style is-active' : 'ocop-learning-question-style',
      attr: { type: 'button', role: 'radio', 'aria-checked': String(selected) },
    });
    option.createEl('strong', { text: title });
    option.createEl('span', { text: description });
    option.addEventListener('click', () => {
      this.questionStyle = style;
      this.renderContent();
    });
  }

  private renderContextIntro(containerEl: HTMLElement): void {
    containerEl.createEl('strong', { text: '시작할 자료' });
    if (!this.recordSource) {
      containerEl.createEl('p', {
        cls: 'setting-item-description',
        text: '사실과 개념의 근거가 되는 학습 자료로 소크라테스식 질문을 시작합니다.',
      });
      return;
    }
    containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: '둘 중 하나로 시작해요. 자료와 기록을 한꺼번에 섞지 않습니다.',
    });
    const sourceEl = containerEl.createDiv({ cls: 'ocop-learning-question-styles' });
    sourceEl.setAttribute('role', 'radiogroup');
    sourceEl.setAttribute('aria-label', '시작할 자료');
    this.addSourceOption(sourceEl, 'materials', '자료로 새로 학습', '학습 자료: 사실과 개념의 근거입니다. 고른 노트만 보내고 지난 기록은 쓰지 않습니다.');
    this.addSourceOption(sourceEl, 'records', '지난 기록으로 복습', '지난 학습 기록: 이전에 한 답과 직접 적은 메모로, 다시 짚을 부분을 알려 줍니다. 정답으로 쓰이지 않습니다.');
  }

  private addSourceOption(containerEl: HTMLElement, source: StartingSource, title: string, description: string): void {
    const selected = this.startSource === source;
    const option = containerEl.createEl('button', {
      cls: selected ? 'ocop-learning-question-style is-active' : 'ocop-learning-question-style',
      attr: { type: 'button', role: 'radio', 'aria-checked': String(selected) },
    });
    option.createEl('strong', { text: title });
    option.createEl('span', { text: description });
    option.addEventListener('click', () => {
      if (this.startSource === source) return;
      this.startSource = source;
      this.selectedRecordPaths.clear();
      this.recordNotice = '';
      // Records begin at Review with nothing checked; materials are a fresh New start.
      this.entry = source === 'records' ? 'review' : 'new';
      this.renderContent();
    });
  }

  /** One line above Start: the one chosen source and what will really be sent. */
  private summaryText(): string {
    if (this.mode !== 'socratic') return '';
    if (this.isRecordsSource()) {
      const count = this.selectedRecordPaths.size;
      const action = this.entry === 'continue' ? '남은 질문을 이어서' : '기록을 다시 읽고';
      return `지난 기록으로 복습 · 기록 ${count}개 — 고른 기록만 보내고 ${action} 소크라테스식 질문을 합니다. 자료 없이 자기 설명을 돕는 참고용이며 사실 여부는 채점하지 않습니다.`;
    }
    const { hasSourceNotes, paths } = this.buildScope();
    return `자료로 새로 학습 · 학습 자료 ${hasSourceNotes ? paths.length : 0}개 — 선택한 자료만 사용합니다. 기록은 사용하지 않습니다.`;
  }

  /** In records mode the start mode follows the checks: Continue needs a record with remaining questions. */
  private syncEntryWithSelection(): void {
    if (this.entry === 'new' || (this.entry === 'continue' && !this.selectedRecords().some(canContinueRecord))) {
      this.entry = 'review';
    }
  }

  private renderRecordSection(containerEl: HTMLElement): void {
    if (!this.recordSource) return;
    const sectionEl = containerEl.createDiv({ cls: 'ocop-learning-records' });
    sectionEl.createEl('strong', { text: '복습할 지난 학습 기록' });
    sectionEl.createEl('p', {
      cls: 'setting-item-description',
      text: '하나 이상 고르세요(과목이 달라도 됩니다). 고른 기록만 이번 대화에서 다시 읽고, 목록을 보는 것만으로는 AI에 아무것도 보내지 않습니다. 현재 열린 노트는 보내지 않습니다.',
    });

    if (this.records.length > 0) {
      const listEl = sectionEl.createDiv({ cls: 'ocop-quiz-note-list ocop-learning-record-list' });
      // Newest first; the open note is not a signal here because records are chosen on their own.
      for (const record of sortByRelevance(this.records, [])) {
        const item = listEl.createDiv({ cls: 'ocop-quiz-note-item' });
        const checkbox = item.createEl('input', { attr: { type: 'checkbox', 'aria-label': record.title } });
        checkbox.checked = this.selectedRecordPaths.has(record.path);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) this.selectedRecordPaths.add(record.path);
          else this.selectedRecordPaths.delete(record.path);
          this.syncEntryWithSelection();
          this.renderContent();
        });
        const duplicate = record.duplicatePaths.length > 0 ? ` · ⚠ 같은 ID가 다른 파일에도 있음(${record.duplicatePaths.length})` : '';
        const date = record.createdAt ? record.createdAt.slice(0, 10) : '';
        item.createSpan({ text: `${record.title} · ${date} · ${record.path}${duplicate}` });
      }
    } else {
      sectionEl.createDiv({ cls: 'setting-item-description', text: '저장된 학습 기록이 아직 없습니다.' });
    }

    let pathInput = '';
    new Setting(sectionEl)
      .setName('다른 기록 열기')
      .setDesc('다른 위치에 있는 기록 파일의 보관함 경로를 입력해 목록에 추가합니다.')
      .addText((text) => text.setPlaceholder('폴더/기록.md').onChange((value) => { pathInput = value.trim(); }))
      .addButton((button) => button.setButtonText('추가').onClick(() => { void this.addRecordByPath(pathInput); }));
    if (this.recordNotice) sectionEl.createDiv({ cls: 'setting-item-description', text: this.recordNotice });

    if (this.records.length === 0) return;
    const entryEl = sectionEl.createDiv({ cls: 'ocop-learning-question-styles' });
    entryEl.setAttribute('role', 'radiogroup');
    entryEl.setAttribute('aria-label', '시작 방식');
    const remaining = this.selectedRecords().some(canContinueRecord);
    this.addEntryOption(entryEl, 'review', '선택한 기록으로 복습', '선택한 기록을 다시 읽고 개념을 짚어 연결합니다.', true);
    this.addEntryOption(entryEl, 'continue', '이어서 하기', '남은 질문이 있는 기록에서만 사용할 수 있습니다. 직접 적은 메모는 복습에서 다시 읽힙니다.', remaining);
    sectionEl.createDiv({
      cls: 'setting-item-description',
      text: '항상 새 대화에서 시작합니다. 지금 대화는 기록에 그대로 남습니다.',
    });
  }

  private addEntryOption(containerEl: HTMLElement, entry: RecordEntry, title: string, description: string, enabled: boolean): void {
    const selected = this.entry === entry;
    const option = containerEl.createEl('button', {
      cls: selected ? 'ocop-learning-question-style is-active' : 'ocop-learning-question-style',
      attr: { type: 'button', role: 'radio', 'aria-checked': String(selected) },
    });
    option.createEl('strong', { text: title });
    option.createEl('span', { text: description });
    if (!enabled) {
      option.disabled = true;
      option.setAttribute('aria-disabled', 'true');
    }
    option.addEventListener('click', () => {
      if (!enabled) return;
      this.entry = entry;
      this.renderContent();
    });
  }

  private async addRecordByPath(path: string): Promise<void> {
    if (!this.recordSource || !path) return;
    const summary = await readRecordSummary(this.recordSource.fs, path).catch(() => null);
    if (!summary) {
      this.recordNotice = '학습 기록 형식의 파일을 찾지 못했습니다.';
    } else if (this.records.some((record) => record.path === summary.path)) {
      this.recordNotice = '이미 목록에 있습니다.';
    } else {
      this.records = [...this.records, summary];
      this.selectedRecordPaths.add(summary.path);
      this.syncEntryWithSelection();
      this.recordNotice = '';
    }
    this.renderContent();
  }

  /** What will be sent, shown before anything is dispatched. */
  private renderStartPreview(result: SocraticSetupResult, bodies: LearningRecordBody[], excerpts: SourceExcerpt[]): void {
    this.contentEl.createEl('h3', { text: '이대로 시작할까요?' });
    const materials = this.contentEl.createDiv({ cls: 'ocop-learning-preview' });
    materials.createEl('strong', { text: `학습 자료 ${result.sourcePaths.length}개` });
    if (result.sourcePaths.length > 0) {
      const shown = excerpts.slice(0, PREVIEW_EXCERPT_NOTES);
      const anyCut = shown.some((excerpt) => excerpt.chars > excerpt.text.length);
      materials.createEl('p', {
        cls: 'setting-item-description',
        text: anyCut || excerpts.length > shown.length
          ? `화면에는 노트마다 앞 ${PREVIEW_EXCERPT_CHARS}자까지만 보여 줍니다(발췌). 선택한 노트의 전체 내용을 AI가 읽으며, 발췌된 부분만 전달되는 것이 아닙니다.`
          : '아래는 선택한 노트의 전체 내용입니다. 이 노트들을 AI가 읽습니다.',
      });
      for (const excerpt of shown) {
        const item = materials.createDiv({ cls: 'ocop-learning-record-item' });
        const cut = excerpt.chars > excerpt.text.length;
        item.createEl('strong', {
          text: cut ? `${excerpt.path} (앞 ${excerpt.text.length}자 / 전체 ${excerpt.chars}자)` : `${excerpt.path} (${excerpt.chars}자)`,
        });
        // Text node only: note content is never interpreted as HTML or Markdown here.
        item.createEl('pre', { cls: 'ocop-learning-record-content', text: excerpt.text });
      }
      const rest = result.sourcePaths.filter((path) => !shown.some((excerpt) => excerpt.path === path));
      if (rest.length > 0) {
        materials.createEl('p', {
          cls: 'setting-item-description',
          text: `나머지 ${rest.length}개 노트는 경로만 표시합니다. 내용은 모두 AI가 읽습니다.`,
        });
        const list = materials.createEl('ul', { cls: 'ocop-learning-preview-paths' });
        for (const path of rest) list.createEl('li', { text: path });
      }
    } else {
      materials.createEl('p', { text: 'No verified original learning material available. 자료 없이 기록만 참고하는 자기 설명 모드이며, 사실 여부를 채점하지 않습니다.' });
    }
    if (bodies.length > 0) {
      const records = this.contentEl.createDiv({ cls: 'ocop-learning-preview' });
      records.createEl('strong', {
        text: `보낼 기록 ${bodies.length}개 · ${Math.ceil(totalRecordBytes(bodies) / 1024)}KiB / ${MAX_SELECTED_RECORD_BYTES / 1024}KiB`,
      });
      records.createEl('p', {
        cls: 'setting-item-description',
        text: '아래는 선택한 기록의 전체 내용입니다. 내용은 빠짐없이 전달되지만, 기록이 지시로 읽히지 않도록 앞뒤 공백을 지우고 &, <, >, @ 같은 기호와 특수 표시를 안전한 문자로 바꿔 보냅니다. 실제로 전달되는 모습은 각 기록 아래 "실제 전달 형태"에서 확인할 수 있습니다.',
      });
      for (const body of bodies) {
        const item = records.createDiv({ cls: 'ocop-learning-record-item' });
        item.createEl('strong', { text: `${body.path} (${body.bytes}바이트)` });
        // Text node only: record content is never interpreted as HTML or Markdown here.
        item.createEl('pre', { cls: 'ocop-learning-record-content', text: body.body });
        // The exact text placed in the prompt (same function as buildRecordContext), shown as text only.
        const sent = item.createEl('details', { cls: 'ocop-learning-record-sent-details' });
        sent.createEl('summary', { text: '실제 전달 형태 (안전하게 바꾼 글자)' });
        sent.createEl('pre', { cls: 'ocop-learning-record-sent', text: escapeRecordText(body.body.trim()) });
      }
    }
    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: bodies.length > 0
        ? '기록 내용은 참고용 자료로만 전달되며 정답이나 권한으로 쓰이지 않습니다. 시작 직전에 파일이 바뀌면 다시 확인을 요청합니다.'
        : '지난 기록은 사용하지 않습니다. 시작 직전에 노트가 바뀌면 다시 확인을 요청합니다.',
    });
    const buttonsEl = this.contentEl.createDiv({ cls: 'ocop-setup-modal-buttons' });
    buttonsEl.createEl('button', { text: '뒤로', cls: 'ocop-cancel-btn' }).addEventListener('click', () => {
      this.pendingStart = null;
      this.renderContent();
    });
    buttonsEl.createEl('button', { text: '시작', cls: 'ocop-save-btn mod-cta' }).addEventListener('click', () => {
      this.finish(result);
    });
  }

  onClose() {
    this.contentEl.empty();
    if (this.resolvePromise) {
      this.resolvePromise(null);
      this.resolvePromise = null;
    }
  }

  openAndWait(): Promise<LearningSetupResult | null> {
    this.open();
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  private buildResult(bodies?: LearningRecordBody[]): LearningSetupResult {
    // A records start carries no course material: the open note is neither listed nor read.
    const recordsOnly = this.isRecordsSource();
    const { sourceInstruction, displayScope, hasSourceNotes, paths } = recordsOnly
      ? { sourceInstruction: NO_EVIDENCE, displayScope: '지난 학습 기록 복습', hasSourceNotes: false, paths: [] as string[] }
      : this.buildScope();
    const focusText = this.focusText || undefined;
    const sourcePaths = [...paths];
    const sourceFingerprints: Record<string, string> = {};
    for (const path of sourcePaths) {
      const fingerprint = this.sourceFingerprints.get(path);
      if (fingerprint) sourceFingerprints[path] = fingerprint;
    }

    if (this.mode === 'quiz') {
      return {
        mode: 'quiz',
        displayContent: buildQuizDisplayContent({
          displayScope,
          questionCount: this.questionCount,
          difficulty: this.difficulty,
          questionStyle: this.questionStyle,
          focusText,
        }),
        totalQuestions: Number(this.questionCount),
        difficulty: this.difficulty,
        questionStyle: this.questionStyle,
        sourceInstruction,
        focusText,
        hasSourceNotes,
        sourcePaths,
        sourceFingerprints,
        enableWebSearch: shouldEnableQuizWebSearch(this.difficulty),
        prompt: buildQuizPrompt({
          questionCount: this.questionCount,
          difficulty: this.difficulty,
          questionStyle: this.questionStyle,
          scopeInstruction: sourceInstruction,
          focusText,
        }),
      };
    }

    const recordBodies = bodies ?? [];
    // Every Socratic start from the record-aware setup is a saved-record entry, even with zero
    // records or a missing folder: "new" is isolated from the earlier conversation too.
    const savedEntry = this.mode === 'socratic' && this.recordSource ? this.entry : undefined;
    const referenceOnly = recordBodies.length > 0 && !hasSourceNotes;
    const recordContext = recordBodies.length > 0 ? buildRecordContext(this.entry, recordBodies) : undefined;
    const recordFingerprints: Record<string, string> = {};
    for (const body of recordBodies) recordFingerprints[body.path] = body.fingerprint;
    // A reference-only start must not carry a forged course ground-truth instruction.
    const scopeInstruction = referenceOnly ? REFERENCE_ONLY_INSTRUCTION : sourceInstruction;

    return {
      mode: 'socratic',
      displayContent: buildSocraticDisplayContent({ displayScope, focusText }),
      sourceInstruction: scopeInstruction,
      focusText,
      hasSourceNotes,
      sourcePaths,
      sourceFingerprints,
      entry: savedEntry,
      recordPaths: recordBodies.map((body) => body.path),
      recordFingerprints,
      referenceOnly,
      prompt: buildSocraticPrompt({ scopeInstruction, focusText, supportLevel: 1, recordContext, referenceOnly }),
    };
  }

  private buildScope(): { sourceInstruction: string; displayScope: string; hasSourceNotes: boolean; paths: string[] } {
    let candidates: string[];
    let displayScope: string;
    const isCurrentNote = this.learningScope === 'current-note' && this.activeFilePath !== null;
    if (isCurrentNote && this.activeFilePath) {
      candidates = [this.activeFilePath];
      displayScope = `현재 노트 · ${getBasename(this.activeFilePath)}`;
    } else if (this.learningScope === 'note') {
      candidates = Array.from(this.selectedNotePaths);
      displayScope = '';
    } else {
      const selectedFolders = Array.from(this.selectedFolderPaths);
      candidates = getFolderNotePaths(this.app.vault.getMarkdownFiles().map((file) => file.path), selectedFolders);
      displayScope = selectedFolders.length === 1
        ? `폴더 · ${summarizeFolder(selectedFolders[0])}`
        : `폴더 ${selectedFolders.length}개`;
    }

    const paths = candidates.filter((path) => !this.emptyNotePaths.has(path));
    if (this.learningScope === 'note') {
      displayScope = paths.length > 0 ? summarizeSelectedNotes(paths) : '선택한 노트 0개';
    }
    if (paths.length === 0) {
      return {
        sourceInstruction: NO_EVIDENCE,
        displayScope,
        hasSourceNotes: false,
        paths,
      };
    }

    const refs = paths.map((path) => `@${path}`).join(', ');
    const subject = isCurrentNote ? 'the current note' : 'the selected notes';
    let sourceInstruction: string;
    if (this.mode === 'socratic') {
      sourceInstruction = isCurrentNote
        ? `The following note is the source material for the dialogue: ${refs}`
        : `The following notes are the source material for the dialogue: ${refs}`;
    } else if (this.difficulty === '상') {
      sourceInstruction = `Use ${subject} as primary course ground truth; official web sources may supplement application context: ${refs}`;
    } else {
      sourceInstruction = isCurrentNote
        ? `Use only the current note as ground truth source material: ${refs}`
        : `Use only these selected notes as ground truth source material: ${refs}`;
    }
    return { sourceInstruction: withPreparationGuidance(sourceInstruction), displayScope, hasSourceNotes: true, paths };
  }

  private finish(result: LearningSetupResult | null) {
    const resolve = this.resolvePromise;
    this.resolvePromise = null;
    this.close();
    resolve?.(result);
  }
}
