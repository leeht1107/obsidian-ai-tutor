import { Notice } from 'obsidian';

import { buildRecordDraft, type SaveOutcome } from '../../../core/learning/records';
import type ObsidianCopilotPlugin from '../../../main';
import { LearningRecordSaveModal } from '../../../ui/modals/LearningRecordSaveModal';

const BANNERS = {
  conflict: '이미 같은 위치에 다른 내용의 파일이 있습니다. 기존 파일은 그대로 두었습니다. 다른 파일 이름으로 새로 저장하거나 취소하세요.',
  missing: '이전에 저장하려던 파일이 지금은 없습니다. 삭제되었는지, 만들어지지 않았는지 알 수 없어서 자동으로 다시 만들지 않습니다. 다시 저장하려면 직접 확인해 주세요.',
  uncertain: '이전 저장 결과를 확인하지 못했습니다. 파일이 없는 것을 확인했습니다. 다시 저장하려면 직접 확인해 주세요.',
} as const;

/** Owns the save flow of a completed learning message, bound to that message's own snapshot. */
export class LearningRecordController {
  constructor(private readonly plugin: ObsidianCopilotPlugin) {}

  async openSave(conversationId: string, messageId: string): Promise<SaveOutcome | null> {
    const { plugin } = this;
    const snapshot = plugin.getLearningSnapshot(conversationId, messageId);
    const conversation = plugin.getConversationById(conversationId);
    if (!snapshot || !conversation) {
      new Notice('이 학습의 기록 초안을 찾을 수 없습니다.');
      return null;
    }
    const service = plugin.getLearningRecordSaveService();
    if (service.isSaving(conversationId, messageId)) {
      new Notice('저장이 진행 중입니다.');
      return null;
    }

    // Read-only look at what an earlier attempt left behind.
    const earlier = await service.inspect(conversationId, messageId);
    if (earlier.kind === 'saved' && earlier.target === 'match') {
      await this.reveal(earlier.path);
      return { kind: 'already-saved', path: earlier.path };
    }
    if (earlier.kind === 'pending' && earlier.target === 'match') {
      const repaired = await service.repairLink(conversationId, messageId);
      this.report(repaired);
      return repaired;
    }
    let banner: string | undefined;
    let freshChoice = false;
    if (earlier.kind !== 'none') {
      freshChoice = true;
      banner = earlier.target === 'absent' ? BANNERS.missing : BANNERS.conflict;
    }

    const folder = plugin.settings.learningRecordsFolder;
    const draft = buildRecordDraft({ snapshot, conversation, folder });
    const choice = await new LearningRecordSaveModal(plugin.app, {
      folder,
      fileName: draft.fileName,
      markdown: draft.markdown,
      banner,
      confirmLabel: freshChoice ? '새로 저장' : '저장',
    }).openAndWait();
    if (!choice) return null;

    const outcome = await service.save({
      conversationId,
      completionMessageId: messageId,
      folder,
      fileName: choice.fileName.trim(),
      markdown: choice.markdown,
      previewRevision: 1,
      freshChoice,
    });
    this.report(outcome);
    return outcome;
  }

  private async reveal(path: string): Promise<void> {
    try {
      await this.plugin.app.workspace.openLinkText(path, '', false);
      new Notice(`이미 저장된 학습 기록입니다: ${path}`);
    } catch {
      new Notice(`이미 저장된 학습 기록입니다: ${path}`);
    }
  }

  private report(outcome: SaveOutcome): void {
    switch (outcome.kind) {
      case 'saved':
        new Notice(`학습 기록을 저장했습니다: ${outcome.path}`);
        break;
      case 'already-saved':
        new Notice(`이미 저장된 학습 기록입니다: ${outcome.path}`);
        break;
      case 'saved-link-failed':
        new Notice(`노트는 저장됐지만 대화 기록에 연결하지 못했습니다: ${outcome.path}. 다시 눌러 연결만 복구할 수 있고, 노트를 또 만들지는 않습니다.`);
        break;
      case 'conflict':
        new Notice(`같은 위치에 다른 내용의 파일이 있어 저장하지 않았습니다: ${outcome.path}`);
        break;
      case 'needs-fresh-choice':
        new Notice(`저장 결과를 확인할 수 없습니다(파일 없음): ${outcome.path}. 자동으로 다시 만들지 않았습니다.`);
        break;
      case 'rejected':
        new Notice(outcome.reason === 'intent-not-acknowledged'
          ? '저장 기록을 안전하게 남기지 못해 노트를 만들지 않았습니다.'
          : outcome.reason === 'invalid-record'
            ? '학습 기록 형식(머리말의 type, formatVersion, recordId)이 맞지 않아 저장하지 않았습니다.'
            : '저장할 수 없는 요청입니다.');
        break;
    }
  }
}
