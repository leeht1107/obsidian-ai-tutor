import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

/** Persistent expert-setting consent. Each actual Agent transition is confirmed again. */
export class UnsafeAgyAgentConsentModal extends Modal {
  private answered = false;

  constructor(app: App, private readonly onResolve: (accepted: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl('h3', { text: 'Agy 위험 Agent 모드를 허용할까요?' });
    this.contentEl.createEl('p', {
      text: '이 설정은 --dangerously-skip-permissions를 사용할 수 있게 합니다. Agent로 전환하면 Agy가 금고 밖 파일에도 접근하고, 파일 수정·삭제와 명령 실행을 개별 승인 없이 할 수 있습니다.',
    });
    this.contentEl.createEl('p', {
      text: '설정을 켜도 Agent로 바꿀 때마다 다시 확인합니다. 취소하거나 창을 닫으면 꺼진 상태를 유지합니다.',
      cls: 'setting-item-description',
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('취소').onClick(() => this.finish(false)))
      .addButton((button) => button.setButtonText('위험을 이해하고 허용').setWarning().onClick(() => this.finish(true)));
  }

  private finish(accepted: boolean): void {
    this.answered = true;
    this.onResolve(accepted);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.answered) this.onResolve(false);
  }
}
