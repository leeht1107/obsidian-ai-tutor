import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

/**
 * Shown once, on the launch that actually moved credentials out of the vault.
 *
 * Two of the three paragraphs explain what happened; the third is the one that
 * matters most. Moving the token off the synced file means a second machine
 * opening the same vault finds no token there, and a student who is not told
 * that will read it as the plugin having broken.
 */
export class SecretMoveNoticeModal extends Modal {
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: '인증 정보를 이 PC 안으로 옮겼습니다' });

    contentEl.createEl('p', {
      text: 'OneDrive나 iCloud 같은 동기화 폴더에 금고(vault)를 두면, 노트뿐 아니라 '
        + '설정 파일도 함께 클라우드로 올라갑니다. 지금까지는 GitHub 토큰과 환경 변수가 '
        + '그 설정 파일 안에 그대로 적혀 있었습니다.',
    });

    contentEl.createEl('p', {
      text: '방금 그 값들을 설정 파일에서 빼내어 이 컴퓨터 안에만 보관하도록 옮겼습니다. '
        + '금고를 다른 사람과 공유하거나 GitHub에 올려도 인증 정보는 따라가지 않습니다.',
    });

    contentEl.createEl('p', {
      text: '대신 다른 컴퓨터에서 같은 금고를 열면 토큰이 비어 있습니다. '
        + '그때는 설정 화면에서 한 번 더 입력해 주세요.',
      cls: 'setting-item-description',
    });

    new Setting(contentEl).addButton((button) =>
      button.setButtonText('알겠습니다').setCta().onClick(() => this.close())
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Convenience wrapper so callers do not have to import Modal plumbing. */
export function showSecretMoveNotice(app: App): void {
  new SecretMoveNoticeModal(app).open();
}
