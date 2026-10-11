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
  isStudyBriefFrontmatter,
  type LearningScope,
  PREPARED_EVIDENCE_ONLY,
  type QuizDifficulty,
  type QuizQuestionStyle,
  shouldEnableQuizWebSearch,
  summarizeFolder,
  summarizeSelectedNotes,
} from '../../core/learning';
import type { StudyGoalBinding } from '../../core/storage/StorageService';

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
  /** False when no course note survived filtering; only prepared Brief concepts may be used. */
  hasSourceNotes: boolean;
  studyGoal?: { briefPath: string; folderPath: string; contextPath: string; existingId?: string; webSearch?: boolean };
}

export interface SocraticSetupResult {
  mode: 'socratic';
  prompt: string;
  displayContent: string;
  sourceInstruction: string;
  focusText?: string;
  hasSourceNotes: boolean;
  studyGoal?: { briefPath: string; folderPath: string; contextPath: string; existingId?: string; webSearch?: boolean };
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
  private briefPath = '';
  private studyFolderPath = '';
  private studyContextPath = '';
  private studyWebSearch = false;
  private briefSelectionDisabled = false;
  /** True while briefPath comes from the selected notes rather than the Brief dropdown. */
  private briefInferred = false;
  /** Per-render memo of which note paths are StudyBriefs. */
  private briefPathMemo = new Map<string, boolean>();
  private quizPreferencesTouched = new Set<'questionCount' | 'difficulty' | 'questionStyle'>();

  constructor(
    app: App,
    private readonly activeFilePath: string | null,
    initialMode: LearningSetupMode,
    initialFocusText = '',
    private readonly existingGoals: StudyGoalBinding[] = [],
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
    this.briefPathMemo.clear();

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
    this.inferBriefFromSelectedSource();

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
            const briefBefore = this.briefPath;
            this.inferBriefFromSelectedSource();
            if (this.briefPath !== briefBefore) {
              this.renderContent();
            } else {
              noteCountEl.setText(`현재 선택: ${this.selectedNotePaths.size}개 노트`);
            }
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
      .setDesc('학습에 사용할 노트 범위를 정합니다.')
      .addDropdown((dropdown) => {
        if (this.activeFilePath) {
          dropdown.addOption('current-note', '현재 노트');
        }
        dropdown.addOption('note', '노트 선택');
        dropdown.addOption('folder', '폴더 선택');
        dropdown.setValue(this.learningScope).onChange((value: LearningScope) => {
          this.learningScope = value;
          const briefBefore = this.briefPath;
          this.inferBriefFromSelectedSource();
          if (this.briefPath !== briefBefore) this.renderContent();
          else renderDetails();
        });
      });

    const briefPaths = this.getBriefPaths(candidateNotes);
    if (briefPaths.length > 0) {
      new Setting(this.contentEl)
        .setName('학습 목표 Brief (선택)')
        .setDesc('Brief를 적용하지 않고 기존 방식으로 학습할 수도 있습니다.')
        .addDropdown((dropdown) => {
          dropdown.addOption('', 'Brief 없이 기존 방식으로 학습');
          for (const path of briefPaths) dropdown.addOption(path, path);
          dropdown.setValue(this.briefPath).onChange((value) => this.handleBriefSelection(value));
        });
    }

    renderDetails();

    if (this.briefPath) {
      const match = this.existingGoals.find((goal) => goal.briefPath === this.briefPath);
      const folders = Array.from(new Set(allFolders)).sort();
      if (!this.studyFolderPath) this.studyFolderPath = match?.folderPath ?? '';
      if (!this.studyContextPath) this.studyContextPath = match?.contextPath ?? `${this.studyFolderPath}/STUDY_CONTEXT.md`;
      new Setting(this.contentEl)
        .setName('목표 맥락 저장 폴더 확인')
        .setDesc(match ? `확인된 목표 폴더 재사용: ${match.folderPath}` : '새 목표입니다. 폴더를 직접 선택하거나 경로를 입력해 확인하세요.')
        .addDropdown((dropdown) => {
          dropdown.addOption('', '폴더 선택');
          for (const path of folders) dropdown.addOption(path, path);
          dropdown.setValue(folders.includes(this.studyFolderPath) ? this.studyFolderPath : '').onChange((value) => {
            this.studyFolderPath = value;
            const goal = this.existingGoals.find((item) => item.briefPath === this.briefPath && item.folderPath === value);
            this.studyContextPath = goal?.contextPath ?? `${value}/STUDY_CONTEXT.md`;
            this.renderContent();
          });
        })
        .addText((text) => text.setPlaceholder('새 폴더 경로').setValue(this.studyFolderPath).onChange((value) => {
          this.studyFolderPath = value.trim().replace(/^\/+|\/+$/g, '');
          this.studyContextPath = `${this.studyFolderPath}/STUDY_CONTEXT.md`;
        }));
      if (this.studyFolderPath) {
        const existingContextPaths = allNotes.filter((path) => path.startsWith(`${this.studyFolderPath}/`));
        new Setting(this.contentEl)
          .setName('학습 맥락 문서')
          .setDesc('폴더 안의 기존 맥락 문서를 선택하거나 기본 문서를 사용합니다.')
          .addDropdown((dropdown) => {
            const defaultPath = `${this.studyFolderPath}/STUDY_CONTEXT.md`;
            dropdown.addOption(defaultPath, `새 기본 문서 · ${defaultPath}`);
            for (const path of existingContextPaths) dropdown.addOption(path, path);
            dropdown.setValue(existingContextPaths.includes(this.studyContextPath) ? this.studyContextPath : defaultPath)
              .onChange((value) => { this.studyContextPath = value; });
          });
      }
    }

    if (this.mode === 'quiz') {
      this.renderQuizSettings();
    } else {
      const supportEl = this.contentEl.createDiv({ cls: 'ocop-learning-prerequisite-note' });
      supportEl.createEl('strong', { text: '막히는 개념은 예시로 풀어봐요' });
      supportEl.createEl('p', {
        text: '선수과목 기초가 비어 있거나 강의자료의 설명이 부족하면, 이해에 필요한 만큼 쉬운 예시로 설명한 뒤 수업 주제와 연결합니다.',
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
    startBtn.addEventListener('click', () => {
      const result = this.buildResult();
      if (this.canStart(result)) this.finish(result);
    });
  }

  private canStart(result: LearningSetupResult): boolean {
    if (this.briefPath && !this.isValidBriefFile(this.briefPath)) {
      new Notice('선택한 Brief가 Vault에 없습니다. 노트를 다시 선택한 뒤 시작해 주세요.');
      return false;
    }
    if (this.briefPath && !this.studyFolderPath) {
      new Notice('Brief 목표를 적용하려면 학습 맥락을 저장할 폴더를 선택하거나 입력하세요.');
      return false;
    }
    if (!result.hasSourceNotes && !result.studyGoal) {
      new Notice('학습 근거로 쓸 수업 자료 노트가 없습니다. Brief·학습 기록이 아닌 수업 자료 노트를 선택하세요.');
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
          this.quizPreferencesTouched.add('questionCount');
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
          this.quizPreferencesTouched.add('difficulty');
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
      this.quizPreferencesTouched.add('questionStyle');
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
    this.briefPathMemo.clear();
    this.inferBriefFromSelectedSource();
    const { sourceInstruction, displayScope, hasSourceNotes } = this.buildScope();
    const focusText = this.focusText || undefined;
    const studyGoal = this.briefPath && this.studyFolderPath
      ? {
        briefPath: this.briefPath,
        folderPath: this.studyFolderPath,
        contextPath: this.studyContextPath || `${this.studyFolderPath}/STUDY_CONTEXT.md`,
        existingId: this.existingGoals.find((goal) => goal.briefPath === this.briefPath && goal.folderPath === this.studyFolderPath)?.id,
        ...(this.studyWebSearch ? { webSearch: true } : {}),
      }
      : undefined;

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
        studyGoal,
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
      studyGoal,
      prompt: buildSocraticPrompt({ scopeInstruction: sourceInstruction, focusText, supportLevel: 1 }),
    };
  }

  private buildScope(): { sourceInstruction: string; displayScope: string; hasSourceNotes: boolean } {
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

    const paths = this.getQuestionEvidencePaths(candidates);
    if (this.learningScope === 'note') {
      displayScope = paths.length > 0 ? summarizeSelectedNotes(paths) : '선택한 노트 0개';
    }
    if (paths.length === 0) {
      return {
        sourceInstruction: this.briefPath && this.studyFolderPath ? PREPARED_EVIDENCE_ONLY : NO_EVIDENCE,
        displayScope,
        hasSourceNotes: false,
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
    return { sourceInstruction, displayScope, hasSourceNotes: true };
  }

  private finish(result: LearningSetupResult | null) {
    const resolve = this.resolvePromise;
    this.resolvePromise = null;
    this.close();
    resolve?.(result);
  }

  /** Optional frontmatter preferences, only for an explicitly selected Brief. */
  private applyBriefPreferences(frontmatter: Record<string, unknown>) {
    const existingGoal = this.existingGoals.find(goal => goal.briefPath === this.briefPath);
    if (existingGoal) {
      this.studyFolderPath = existingGoal.folderPath;
      this.studyContextPath = existingGoal.contextPath;
    }
    const folder = typeof frontmatter.study_folder === 'string'
      ? frontmatter.study_folder.trim().replace(/^\/+|\/+$/g, '')
      : '';
    // A previously confirmed goal always wins over a suggested folder.
    if (!this.studyFolderPath && !existingGoal
      && folder && !folder.split('/').some(part => !part || part === '.' || part === '..')) {
      this.studyFolderPath = folder;
      this.studyContextPath = `${folder}/STUDY_CONTEXT.md`;
    }
    if (!this.quizPreferencesTouched.has('difficulty')
      && (frontmatter.quiz_difficulty === '상' || frontmatter.quiz_difficulty === '중' || frontmatter.quiz_difficulty === '하')) {
      this.difficulty = frontmatter.quiz_difficulty;
    }
    if (!this.quizPreferencesTouched.has('questionStyle')
      && (frontmatter.quiz_style === 'application' || frontmatter.quiz_style === 'material')) {
      this.questionStyle = frontmatter.quiz_style;
    }
    const count = String(frontmatter.quiz_count ?? '');
    if (!this.quizPreferencesTouched.has('questionCount') && ['3', '4', '5', '6', '7', '8', '9', '10'].includes(count)) {
      this.questionCount = count;
    }
    this.studyWebSearch = frontmatter.study_web_search === true || frontmatter.study_web_search === 'true';
  }

  private handleBriefSelection(value: string) {
    this.briefSelectionDisabled = !value;
    this.briefInferred = false;
    if (value !== this.briefPath) {
      this.studyFolderPath = '';
      this.studyContextPath = '';
      this.resetUnchangedBriefPreferences();
    }
    this.briefPath = value;
    const file = value ? this.app.vault.getAbstractFileByPath?.(value) : null;
    if (file instanceof TFile) {
      const cached = this.app.metadataCache?.getFileCache?.(file)?.frontmatter;
      if (cached) {
        this.applyBriefPreferences(cached);
      } else {
        // A newly copied Brief can be selected before the metadata cache updates.
        void this.app.vault.cachedRead(file).then(body => {
          if (this.briefPath !== value) return;
          const yaml = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1];
          if (!yaml) return;
          const values: Record<string, unknown> = {};
          for (const line of yaml.split(/\r?\n/)) {
            const match = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
            if (match) values[match[1]] = match[2];
          }
          this.applyBriefPreferences(values);
          this.renderContent();
        }).catch(() => { /* Keep manual controls available. */ });
      }
    }
    this.renderContent();
  }

  private resetUnchangedBriefPreferences() {
    if (!this.quizPreferencesTouched.has('questionCount')) this.questionCount = '5';
    if (!this.quizPreferencesTouched.has('difficulty')) this.difficulty = '중';
    if (!this.quizPreferencesTouched.has('questionStyle')) this.questionStyle = 'material';
    this.studyWebSearch = false;
  }

  /**
   * A source note opts into goal preparation through its own frontmatter. An inferred
   * Brief follows the selection, so unticking that note releases it again.
   */
  private inferBriefFromSelectedSource(): void {
    if (this.briefSelectionDisabled || (this.briefPath && !this.briefInferred)) return;
    // Folder scope selects no single note, so it releases an inferred Brief; the dropdown can still pick one.
    const selectedPaths = this.learningScope === 'current-note' && this.activeFilePath
      ? [this.activeFilePath]
      : this.learningScope === 'note' ? Array.from(this.selectedNotePaths) : [];
    const candidates = selectedPaths.flatMap((path) => {
      const file = this.app.vault.getAbstractFileByPath?.(path);
      if (!(file instanceof TFile)) return [];
      const frontmatter = this.app.metadataCache?.getFileCache?.(file)?.frontmatter;
      return frontmatter && isStudyBriefFrontmatter(frontmatter) ? [{ path, frontmatter }] : [];
    });
    const next = candidates.length === 1 ? candidates[0] : null;
    if ((next?.path ?? '') === this.briefPath) return;
    this.briefPath = '';
    this.briefInferred = false;
    this.studyFolderPath = '';
    this.studyContextPath = '';
    this.resetUnchangedBriefPreferences();
    if (!next) return;
    this.briefPath = next.path;
    this.briefInferred = true;
    this.applyBriefPreferences(next.frontmatter);
  }

  private isStudyBriefPath(path: string): boolean {
    const known = this.briefPathMemo.get(path);
    if (known !== undefined) return known;
    const file = this.app.vault.getAbstractFileByPath?.(path);
    const isBrief = file instanceof TFile && (
      isStudyBriefFrontmatter(this.app.metadataCache?.getFileCache?.(file)?.frontmatter)
      || this.existingGoals.some((goal) => goal.briefPath === path)
    );
    this.briefPathMemo.set(path, isBrief);
    return isBrief;
  }

  private isValidBriefFile(path: string): boolean {
    return this.app.vault.getAbstractFileByPath?.(path) instanceof TFile;
  }

  private getBriefPaths(candidateNotes: string[]): string[] {
    const savedPaths = this.existingGoals.map((goal) => goal.briefPath).filter((path) => this.isValidBriefFile(path));
    const selectedPaths = this.briefPath && this.isValidBriefFile(this.briefPath) ? [this.briefPath] : [];
    return Array.from(new Set([
      ...candidateNotes.filter((path) => this.isStudyBriefPath(path)),
      ...savedPaths,
      ...selectedPaths,
    ])).sort();
  }

  /** Brief and tutor-written documents are never course evidence, in any mode or scope. */
  private getQuestionEvidencePaths(paths: string[]): string[] {
    return paths.filter((path) => {
      const basename = path.split('/').pop()?.toUpperCase();
      if (basename === 'QUIZ_HISTORY.MD' || basename === 'STUDY_CONTEXT.MD') return false;
      if (path === this.studyContextPath || this.existingGoals.some((goal) => goal.contextPath === path)) return false;
      return path !== this.briefPath && !this.isStudyBriefPath(path);
    });
  }
}
