/**
 * The one place that decides what "the note" is for edit review. An open note is its
 * editor buffer, which holds keystrokes Obsidian has not saved yet; a closed note is its
 * file. Capturing the base and applying both go through here, so they never disagree.
 */
import type { App, Editor } from 'obsidian';
import { MarkdownView, TFile } from 'obsidian';

import type { ReviewHunk } from '../../core/types/chat';
import { applyReviewHunks, sameNote, toEditorChanges } from './editReview';

function markdownViews(app: App, path: string): MarkdownView[] {
  return app.workspace.getLeavesOfType('markdown')
    .map((leaf) => leaf.view)
    .filter((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === path);
}

/**
 * Editors of every loaded Markdown view showing `path` in an editing mode. Deferred
 * (unloaded) tabs count as closed. A reading-mode tab counts as closed too: Obsidian never
 * saves its hidden editor, so a change made there would not reach the file.
 */
export function findOpenEditors(app: App, path: string): Editor[] {
  return markdownViews(app, path)
    .filter((view) => view.getMode?.() !== 'preview')
    .map((view) => view.editor);
}

/** True when a reading-mode tab still holds text the file does not have yet. */
function readingBufferAhead(app: App, path: string, current: string): boolean {
  return markdownViews(app, path)
    .filter((view) => view.getMode?.() === 'preview')
    .some((view) => !sameNote(view.editor.getValue(), current));
}

/** The note as the student sees it right now, or null when it cannot be read. */
export async function readLiveNote(app: App, path: string): Promise<string | null> {
  const editors = findOpenEditors(app, path);
  if (editors.length > 0) return editors[0].getValue();
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  try {
    return await app.vault.read(file);
  } catch {
    return null;
  }
}

const SYNC_WAIT_MS = 500;

/** True once every editor shows the same text as the first one, within SYNC_WAIT_MS. */
async function editorsAgree(editors: Editor[]): Promise<boolean> {
  const agree = () => editors.every((e) => e.getValue() === editors[0].getValue());
  const deadline = Date.now() + SYNC_WAIT_MS;
  while (!agree()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

export type ApplyResult =
  | { kind: 'applied'; undoable: boolean }
  | { kind: 'stale' }
  | { kind: 'missing' }
  /** The editor did not end up as expected and still equals what it was before. */
  | { kind: 'not_applied' }
  /** The editor did not end up as expected and also differs from before. */
  | { kind: 'check_note' };

/** Writes the accepted hunks only if the note still equals `base`. */
export async function applyToLiveNote(
  app: App,
  path: string,
  base: string,
  hunks: ReviewHunk[],
  acceptedIds: readonly string[],
): Promise<ApplyResult> {
  const editors = findOpenEditors(app, path);
  if (editors.length > 0) {
    // One synchronous block: nothing the student types can land between check and change.
    const before = editors[0].getValue();
    if (!editors.every((e) => sameNote(e.getValue(), base)) || before.includes('\r')) return { kind: 'stale' };
    const expected = applyReviewHunks(before, hunks, acceptedIds);
    const editor = editors[0];
    editor.transaction({
      changes: toEditorChanges(before, hunks, acceptedIds).map((c) => ({
        from: editor.offsetToPos(c.from),
        to: editor.offsetToPos(c.to),
        text: c.text,
      })),
    });
    const after = editor.getValue();
    if (after !== expected) return after === before ? { kind: 'not_applied' } : { kind: 'check_note' };
    // Obsidian copies the change into the note's other editors a moment later (~15 ms in
    // the real-Obsidian self-test F3c). Only call it applied once they all agree.
    return (await editorsAgree(editors)) ? { kind: 'applied', undoable: true } : { kind: 'check_note' };
  }

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { kind: 'missing' };
  let stale = false;
  await app.vault.process(file, (current) => {
    // The note may have been opened while this write waited; its buffer is then the truth.
    if (findOpenEditors(app, path).length > 0 || readingBufferAhead(app, path, current) || !sameNote(current, base)) {
      stale = true;
      return current;
    }
    // Apply to the file's own text so its line endings survive even if the base was LF.
    return applyReviewHunks(current, hunks, acceptedIds);
  });
  return stale ? { kind: 'stale' } : { kind: 'applied', undoable: false };
}
