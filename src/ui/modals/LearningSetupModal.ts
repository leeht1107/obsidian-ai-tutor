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

const EMPTY_NOTE_READ_CONCURRENCY = 16;

export type LearningSetupMode = 'quiz' | 'socratic';

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
}

export interface SocraticSetupResult {
  mode: 'socratic';
  prompt: string;
  displayContent: string;
  sourceInstruction: string;
  focusText?: string;
  hasSourceNotes: boolean;
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

  constructor(
    app: App,
    private readonly activeFilePath: string | null,
    initialMode: LearningSetupMode,
    initialFocusText = '',
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
  }

  private renderContent() {
    this.contentEl.empty();

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

    const detailsEl = this.contentEl.createDiv();
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
    };

    new Setting(this.contentEl)
      .setName('학습 자료')
      .setDesc('학습에 사용할 노트를 고릅니다. 준비 방법을 적은 노트(Brief·개요 등)를 함께 고르면 그 지시에 맞춰 진행합니다.')
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

    if (this.mode === 'quiz') {
      this.renderQuizSettings();
    } else {
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
      this.emptyNotePaths.clear();
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
      this.finish(result);
    } finally {
      this.starting = false;
    }
  }

  /** Notes with no content beyond frontmatter; an unreadable note counts as empty. */
  private async findEmptyNotes(paths: string[]): Promise<string[]> {
    const isEmpty = async (path: string): Promise<boolean> => {
      const file = this.app.vault.getAbstractFileByPath?.(path);
      if (!(file instanceof TFile)) return true;
      try {
        return !stripFrontmatter(await this.app.vault.cachedRead(file)).trim();
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

  private buildResult(): LearningSetupResult {
    const { sourceInstruction, displayScope, hasSourceNotes } = this.buildScope();
    const focusText = this.focusText || undefined;

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

    return {
      mode: 'socratic',
      displayContent: buildSocraticDisplayContent({ displayScope, focusText }),
      sourceInstruction,
      focusText,
      hasSourceNotes,
      prompt: buildSocraticPrompt({ scopeInstruction: sourceInstruction, focusText, supportLevel: 1 }),
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
