import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { LIBREOFFICE_GUIDE_URLS, libreOfficeInstallPrompt } from '../../core/setup/libreOffice';

export interface LibreOfficeNoticeActions {
  /** Open the chat and put `prompt` in the input box; the student presses send. */
  prefillChat: (prompt: string) => Promise<void>;
}

/**
 * Shown once, right after the doc skills were first installed on a computer
 * without LibreOffice. The plugin installs nothing: the main button hands the
 * request to the student's own agent, and the guide is the fallback.
 *
 * The button does not switch to Agent mode by itself. Agent mode has its own
 * consent windows, and a popup that skipped them would grant write access the
 * student never confirmed. The text says to flip Ask to Agent instead.
 */
export class LibreOfficeNoticeModal extends Modal {
  constructor(app: App, private readonly platform: 'darwin' | 'win32', private readonly actions: LibreOfficeNoticeActions) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: '문서 스킬을 다 쓰려면 프로그램 하나가 필요해요' });
    contentEl.createEl('p', {
      text: 'PDF·엑셀·워드·PPT 스킬이 설치됐어요. 그런데 이 컴퓨터에 LibreOffice가 없어서 '
        + '일부 기능(엑셀 수식 다시 계산, 워드·PPT를 PDF로 바꾸기)이 안 돼요. LibreOffice는 무료이고 한 번만 설치하면 돼요.',
    });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: '"에이전트에게 맡기기"를 누르면 채팅 입력창에 설치 요청이 들어가요. 채팅 위의 Ask를 Agent로 바꾼 뒤 보내기를 누르세요.',
    });

    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText('에이전트에게 설치 맡기기')
        .setCta()
        .onClick(async () => {
          this.close();
          await this.actions.prefillChat(libreOfficeInstallPrompt(this.platform));
        }))
      .addButton((button) => button
        .setButtonText('직접 설치하기 (안내서)')
        .onClick(() => {
          window.open(LIBREOFFICE_GUIDE_URLS[this.platform]);
        }))
      .addButton((button) => button
        .setButtonText('나중에')
        .onClick(() => this.close()));

    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: '나중에 설정 › 스킬에서 다시 볼 수 있어요.',
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
