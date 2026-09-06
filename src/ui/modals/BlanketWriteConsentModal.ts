import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';

/**
 * Two of the four CLIs have no workspace boundary in Agent mode — `writesOutsideVault`
 * names them — so what the student is consenting to is reach, not merely auto-approval.
 * A hover tooltip is not consent for that, so the first time a student turns on Agent for
 * such a provider they are asked in a dialog they have to answer.
 */
export class BlanketWriteConsentModal extends Modal {
  private readonly providerLabel: string;
  private readonly onResolve: (accepted: boolean) => void;
  private answered = false;

  constructor(app: App, providerLabel: string, onResolve: (accepted: boolean) => void) {
    super(app);
    this.providerLabel = providerLabel;
    this.onResolve = onResolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: `${this.providerLabel}에 쓰기를 허용할까요?` });
    contentEl.createEl('p', {
      // "이 금고 안에서" was true when only agy reached this dialog and its own sandbox held
      // it there. It is false for the set this now gates: claude under `bypassPermissions`
      // and agy under `--dangerously-skip-permissions` are the two with no workspace
      // boundary, which is exactly why they are the two that ask.
      text: `${this.providerLabel}는 도구를 하나씩 허용하는 방법이 없습니다. Agent로 두면 파일을 만들고 고치고 지우는 것, 명령을 실행하는 것까지 확인 없이 하고, 그 범위가 이 금고 안으로 제한되지 않습니다 — 이 컴퓨터의 다른 파일에도 닿을 수 있습니다.`,
    });
    contentEl.createEl('p', {
      text: 'Ask로 두면 읽기만 하고 아무것도 바꾸지 않습니다. 허용한 뒤에도 토글을 Ask로 되돌리면 다시 읽기 전용이 됩니다.',
      cls: 'setting-item-description',
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText('Ask로 두기').onClick(() => this.finish(false)))
      .addButton((button) => button.setButtonText('쓰기 허용').setCta().onClick(() => this.finish(true)));
  }

  private finish(accepted: boolean): void {
    this.answered = true;
    this.onResolve(accepted);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    // Closing with Escape or the X is not consent.
    if (!this.answered) this.onResolve(false);
  }
}
