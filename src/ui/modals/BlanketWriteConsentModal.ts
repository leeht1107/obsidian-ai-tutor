import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { getProviderDescriptor, type ProviderId, writesOutsideVault } from '../../core/providers/providerRegistry';

/** Per-transition Agent consent. Closing the modal always fails closed to Ask. */
export class BlanketWriteConsentModal extends Modal {
  private readonly provider: ProviderId;
  private readonly onResolve: (accepted: boolean) => void;
  private answered = false;

  constructor(app: App, provider: ProviderId, onResolve: (accepted: boolean) => void) {
    super(app);
    this.provider = provider;
    this.onResolve = onResolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    const providerLabel = getProviderDescriptor(this.provider).label;
    contentEl.empty();
    contentEl.createEl('h3', { text: `${providerLabel}에 쓰기를 허용할까요?` });
    contentEl.createEl('p', {
      text: writesOutsideVault(this.provider)
        ? `${providerLabel}를 Agent로 두면 파일 수정·삭제와 명령 실행을 개별 확인 없이 허용하며, 금고 밖의 다른 파일에도 접근할 수 있습니다.`
        : `${providerLabel}를 Agent로 두면 이 금고 안의 파일 수정·삭제와 도구 실행을 개별 확인 없이 허용합니다.`,
    });
    contentEl.createEl('p', {
      // The unqualified version of this sentence is false, and an adversarial
      // review kept proving it. What Ask actually guarantees is that no new
      // write starts. Something Agent already launched can outlive the switch:
      // on macOS only if it deliberately left its process group, on Windows for
      // any program that outlives the one that started it, because Windows has
      // no process group to tear down as a unit. Naming that is the whole point
      // — a student who is told "nothing" and later sees something is owed the
      // narrower true sentence instead.
      text: 'Ask로 두면 새로 파일을 고치거나 명령을 실행하지 않습니다. 허용한 뒤에도 토글을 Ask로 되돌리면 다시 읽기 전용이 됩니다. '
        + '다만 Agent로 있는 동안 시작된 프로그램은 Ask로 되돌려도 남아 있을 수 있습니다 — Windows에서는 특히 그렇습니다.',
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
