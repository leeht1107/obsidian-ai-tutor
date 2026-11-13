import { Modal, Setting } from 'obsidian';

/**
 * Shown once per computer when a student first switches to agy. agy cannot
 * turn web search off per request, so the toolbar's Web toggle does not bind
 * it. This used to be a line under the chat input, which crowded the toolbar
 * for every agy request (Mark 2026-11-13: "UX가 안 좋아진다").
 */
export class AgyWebSearchNoticeModal extends Modal {
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: 'Agy는 Web 검색을 끌 수 없어요' });
    contentEl.createEl('p', {
      text: 'Agy는 요청마다 Web 검색을 끄는 기능이 없어요. 입력창 아래 Web 스위치가 꺼져 있어도 Agy는 필요하면 인터넷을 검색할 수 있어요.',
    });
    new Setting(contentEl).addButton((button) => button.setButtonText('확인').setCta().onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
