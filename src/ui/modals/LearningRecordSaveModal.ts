import type { App } from 'obsidian';
import { Modal } from 'obsidian';

import { recordProblem, resolveRecordPath } from '../../core/learning/records';

export interface LearningRecordSaveChoice {
  fileName: string;
  markdown: string;
}

export interface LearningRecordSaveModalInput {
  folder: string;
  fileName: string;
  markdown: string;
  /** Why a plain save is not enough (conflict, missing target, ...); empty for a first save. */
  banner?: string;
  /** Shown on the confirm button; defaults to a plain save. */
  confirmLabel?: string;
}

/**
 * The one editable preview. It states where the note will be created and what it will contain,
 * and nothing is written until the student presses the save button.
 */
export class LearningRecordSaveModal extends Modal {
  private resolvePromise: ((choice: LearningRecordSaveChoice | null) => void) | null = null;
  private fileName: string;
  private markdown: string;
  private pathEl: HTMLElement | null = null;
  private problemEl: HTMLElement | null = null;
  private confirmEl: HTMLButtonElement | null = null;

  constructor(app: App, private readonly input: LearningRecordSaveModalInput) {
    super(app);
    this.fileName = input.fileName;
    this.markdown = input.markdown;
  }

  openAndWait(): Promise<LearningRecordSaveChoice | null> {
    this.open();
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  onOpen(): void {
    this.setTitle('학습 기록 저장');
    this.modalEl.addClass('ocop-learning-record-modal');
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('p', {
      text: '아래 내용과 위치로 이 보관함에 새 노트를 만듭니다. [저장]을 누르기 전에는 아무것도 만들어지지 않으며, AI에는 아무것도 보내지 않습니다.',
    });
    if (this.input.banner) {
      contentEl.createDiv({ cls: 'ocop-learning-record-banner', text: this.input.banner });
    }

    const nameRow = contentEl.createDiv({ cls: 'ocop-learning-record-name' });
    nameRow.createSpan({ text: `${this.input.folder}/` });
    const nameInput = nameRow.createEl('input', { attr: { type: 'text', 'aria-label': '파일 이름' } });
    nameInput.value = this.fileName;
    nameInput.addEventListener('input', () => {
      this.fileName = nameInput.value;
      this.refresh();
    });
    this.pathEl = contentEl.createDiv({ cls: 'setting-item-description' });

    const area = contentEl.createEl('textarea', { cls: 'ocop-learning-record-text', attr: { rows: '16', 'aria-label': '저장할 내용' } });
    area.value = this.markdown;
    this.problemEl = contentEl.createDiv({ cls: 'ocop-learning-record-banner' });
    area.addEventListener('input', () => {
      this.markdown = area.value;
      this.refresh();
    });

    const buttons = contentEl.createDiv({ cls: 'ocop-setup-modal-buttons' });
    buttons.createEl('button', { text: '저장 안 함', cls: 'ocop-cancel-btn' }).addEventListener('click', () => this.finish(null));
    this.confirmEl = buttons.createEl('button', { text: this.input.confirmLabel ?? '저장', cls: 'ocop-save-btn mod-cta' });
    this.confirmEl.addEventListener('click', () => {
      if (!this.target() || recordProblem(this.markdown)) return;
      this.finish({ fileName: this.fileName, markdown: this.markdown });
    });
    this.refresh();
  }

  private target(): string | null {
    return resolveRecordPath(this.input.folder, this.fileName.trim());
  }

  private refresh(): void {
    const target = this.target();
    this.pathEl?.setText(target ? `저장 위치: ${target}` : '파일 이름이 올바르지 않습니다 (폴더 구분자 없이 입력하세요).');
    const problem = recordProblem(this.markdown);
    this.problemEl?.setText(problem ? `학습 기록으로 다시 찾을 수 없는 내용입니다: ${problem}. 고치거나 [저장 안 함]을 누르세요.` : '');
    if (this.confirmEl) this.confirmEl.disabled = !target || problem !== null;
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolvePromise?.(null);
    this.resolvePromise = null;
  }

  private finish(choice: LearningRecordSaveChoice | null): void {
    const resolve = this.resolvePromise;
    this.resolvePromise = null;
    this.close();
    resolve?.(choice);
  }
}
