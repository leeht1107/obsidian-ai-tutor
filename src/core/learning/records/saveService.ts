import { newRecordIds } from './draft';
import type { RecordFs } from './fs';
import { recordIdOf } from './markdown';
import { resolveRecordPath, sha256 } from './paths';
import type { CompletedLearningSnapshot, LearningSaveIntent } from './types';

/** What the service needs from the app; `commit` must resolve true only after real storage acknowledgement. */
export interface SaveHost {
  fs: RecordFs;
  getSnapshot(conversationId: string, messageId: string): CompletedLearningSnapshot | null;
  commit(
    conversationId: string,
    messageId: string,
    update: (snapshot: CompletedLearningSnapshot) => CompletedLearningSnapshot,
  ): Promise<boolean>;
  now?: () => number;
}

export interface SaveRequest {
  conversationId: string;
  completionMessageId: string;
  folder: string;
  fileName: string;
  /** The exact confirmed bytes. */
  markdown: string;
  previewRevision: number;
  /** The student explicitly chose to save again after an unresolved earlier attempt. */
  freshChoice?: boolean;
}

export type SaveOutcome =
  | { kind: 'saved'; path: string; recordId: string }
  | { kind: 'already-saved'; path: string }
  | { kind: 'saved-link-failed'; path: string }
  | { kind: 'conflict'; path: string; reason: 'target-differs' | 'verify-mismatch' }
  | { kind: 'needs-fresh-choice'; path: string; reason: 'missing-after-attempt' | 'write-uncertain' }
  | { kind: 'rejected'; reason: 'no-snapshot' | 'invalid-path' | 'intent-not-acknowledged' };

type ReadState = { state: 'absent' } | { state: 'match' } | { state: 'differs' } | { state: 'unreadable' };

export class LearningRecordSaveService {
  private readonly inFlight = new Map<string, Promise<SaveOutcome>>();

  constructor(private readonly host: SaveHost) {}

  /** Same snapshot, same moment: duplicate clicks share one attempt and one outcome. */
  save(request: SaveRequest): Promise<SaveOutcome> {
    const key = `${request.conversationId}\0${request.completionMessageId}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    const attempt = this.run(request).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, attempt);
    return attempt;
  }

  isSaving(conversationId: string, completionMessageId: string): boolean {
    return this.inFlight.has(`${conversationId}\0${completionMessageId}`);
  }

  /** Read-only look at what an earlier attempt left behind; never writes. */
  async inspect(conversationId: string, messageId: string): Promise<
    | { kind: 'none' }
    | { kind: 'saved'; path: string; target: ReadState['state'] }
    | { kind: 'pending'; path: string; target: ReadState['state'] }
  > {
    const snapshot = this.host.getSnapshot(conversationId, messageId);
    if (snapshot?.saved) {
      const target = await this.readTarget(snapshot.saved.path, snapshot.saved.contentFingerprint);
      return { kind: 'saved', path: snapshot.saved.path, target: target.state };
    }
    if (!snapshot?.pendingSave) return { kind: 'none' };
    const target = await this.readTarget(snapshot.pendingSave.path, snapshot.pendingSave.contentFingerprint);
    return { kind: 'pending', path: snapshot.pendingSave.path, target: target.state };
  }

  /** After "note saved; history link failed": repair the link only, never create again. */
  async repairLink(conversationId: string, messageId: string): Promise<SaveOutcome> {
    const snapshot = this.host.getSnapshot(conversationId, messageId);
    if (!snapshot?.pendingSave) return { kind: 'rejected', reason: 'no-snapshot' };
    const intent = snapshot.pendingSave;
    const target = await this.readTarget(intent.path, intent.contentFingerprint);
    if (target.state === 'absent') return { kind: 'needs-fresh-choice', path: intent.path, reason: 'missing-after-attempt' };
    if (target.state !== 'match') return { kind: 'conflict', path: intent.path, reason: 'target-differs' };
    return this.link(intent, 'already-saved');
  }

  private async run(request: SaveRequest): Promise<SaveOutcome> {
    const { conversationId, completionMessageId } = request;
    const snapshot = this.host.getSnapshot(conversationId, completionMessageId);
    if (!snapshot) return { kind: 'rejected', reason: 'no-snapshot' };
    const path = resolveRecordPath(request.folder, request.fileName);
    if (!path) return { kind: 'rejected', reason: 'invalid-path' };
    const fingerprint = sha256(request.markdown);

    if (!request.freshChoice) {
      const earlier = snapshot.saved
        ? { path: snapshot.saved.path, fingerprint: snapshot.saved.contentFingerprint }
        : snapshot.pendingSave
          ? { path: snapshot.pendingSave.path, fingerprint: snapshot.pendingSave.contentFingerprint }
          : null;
      if (earlier) return this.resolveEarlier(snapshot, earlier);
    }

    const existing = await this.readTarget(path, fingerprint);
    if (existing.state === 'differs' || existing.state === 'unreadable') {
      return { kind: 'conflict', path, reason: 'target-differs' };
    }
    if (existing.state === 'match') {
      // The identical bytes are already there (e.g. link ack was lost): link, never rewrite.
      const intent = this.freeze(request, path, fingerprint);
      if (!(await this.stage(intent))) return { kind: 'rejected', reason: 'intent-not-acknowledged' };
      return this.link(intent, 'already-saved');
    }

    const intent = this.freeze(request, path, fingerprint);
    // The pending reference must be durably acknowledged before the note is created.
    if (!(await this.stage(intent))) return { kind: 'rejected', reason: 'intent-not-acknowledged' };

    let writeError = false;
    try {
      await this.host.fs.createOnly(path, request.markdown);
    } catch {
      writeError = true;
    }
    const after = await this.readTarget(path, fingerprint);
    if (after.state === 'match') return this.link(intent, 'saved');
    if (after.state === 'differs' || after.state === 'unreadable') {
      return { kind: 'conflict', path, reason: writeError ? 'target-differs' : 'verify-mismatch' };
    }
    return { kind: 'needs-fresh-choice', path, reason: 'write-uncertain' };
  }

  /** An earlier attempt exists: reconcile that exact target, never write. */
  private async resolveEarlier(
    snapshot: CompletedLearningSnapshot,
    earlier: { path: string; fingerprint: string },
  ): Promise<SaveOutcome> {
    const target = await this.readTarget(earlier.path, earlier.fingerprint);
    if (target.state === 'match') {
      if (snapshot.saved) return { kind: 'already-saved', path: earlier.path };
      if (snapshot.pendingSave) return this.link(snapshot.pendingSave, 'already-saved');
    }
    if (target.state === 'absent') return { kind: 'needs-fresh-choice', path: earlier.path, reason: 'missing-after-attempt' };
    return { kind: 'conflict', path: earlier.path, reason: 'target-differs' };
  }

  private freeze(request: SaveRequest, path: string, contentFingerprint: string): LearningSaveIntent {
    const now = this.host.now?.() ?? Date.now();
    const ids = newRecordIds(now);
    return {
      saveIntentId: ids.saveIntentId,
      recordId: recordIdOf(request.markdown) ?? ids.recordId,
      conversationId: request.conversationId,
      completionMessageId: request.completionMessageId,
      previewRevision: request.previewRevision,
      folder: request.folder,
      path,
      contentFingerprint,
      frozenAt: now,
    };
  }

  private stage(intent: LearningSaveIntent): Promise<boolean> {
    return this.host.commit(intent.conversationId, intent.completionMessageId, (snapshot) => ({
      ...snapshot,
      pendingSave: intent,
      saved: undefined,
    }));
  }

  private async link(intent: LearningSaveIntent, success: 'saved' | 'already-saved'): Promise<SaveOutcome> {
    const savedAt = this.host.now?.() ?? Date.now();
    const acknowledged = await this.host.commit(intent.conversationId, intent.completionMessageId, (snapshot) => ({
      ...snapshot,
      saved: { path: intent.path, recordId: intent.recordId, contentFingerprint: intent.contentFingerprint, savedAt },
    }));
    if (!acknowledged) return { kind: 'saved-link-failed', path: intent.path };
    return success === 'saved'
      ? { kind: 'saved', path: intent.path, recordId: intent.recordId }
      : { kind: 'already-saved', path: intent.path };
  }

  private async readTarget(path: string, fingerprint: string): Promise<ReadState> {
    try {
      if (!(await this.host.fs.exists(path))) return { state: 'absent' };
      const text = await this.host.fs.read(path);
      return sha256(text) === fingerprint ? { state: 'match' } : { state: 'differs' };
    } catch {
      return { state: 'unreadable' };
    }
  }
}
