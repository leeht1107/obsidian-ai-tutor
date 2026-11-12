import { MarkdownView, TFile } from 'obsidian';

import type { EditReviewState } from '@/core/types/chat';
import { buildReviewHunks } from '@/features/edit-review/editReview';
import { renderEditReviewCard } from '@/features/edit-review/EditReviewCard';
import { applyToLiveNote, readLiveNote } from '@/features/edit-review/liveNote';

// Minimal Obsidian-style element: enough for createDiv/createSpan/createEl, empty, click.
function el(tag = 'div', cls = '', text = ''): any {
  const node: any = {
    tag, cls, text, children: [] as any[], dataset: {}, attrs: {} as Record<string, string>, disabled: false, type: '',
    listeners: [] as Array<() => void>,
    createDiv(o: any = {}) { return node.add(el('div', o.cls, o.text)); },
    createSpan(o: any = {}) { return node.add(el('span', o.cls, o.text)); },
    createEl(t: string, o: any = {}) { return node.add(el(t, o.cls, o.text)); },
    add(child: any) { node.children.push(child); return child; },
    empty() { node.children = []; },
    setAttribute(k: string, v: string) { node.attrs[k] = v; },
    addEventListener(_e: string, fn: () => void) { node.listeners.push(fn); },
    click() { node.listeners.forEach((fn: () => void) => fn()); },
  };
  return node;
}
const all = (n: any): any[] => [n, ...n.children.flatMap(all)];
const button = (root: any, prefix: string, index = 0) =>
  all(root).filter((n) => n.tag === 'button' && n.text.startsWith(prefix))[index];
const allText = (root: any) => all(root).map((n) => n.text).join('\n');
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Fake CodeMirror-like editor: LF buffer, transaction changes in pre-change coordinates. */
function fakeEditor(initial: string, opts: { noop?: boolean } = {}) {
  const ed: any = {
    value: initial,
    transactions: 0,
    getValue: () => ed.value,
    offsetToPos(offset: number) {
      const before = ed.value.slice(0, offset).split('\n');
      return { line: before.length - 1, ch: before[before.length - 1].length };
    },
    posToOffset(pos: { line: number; ch: number }) {
      const lines = ed.value.split('\n');
      return lines.slice(0, pos.line).reduce((n: number, l: string) => n + l.length + 1, 0) + pos.ch;
    },
    transaction(tx: any) {
      ed.transactions += 1;
      if (opts.noop) return;
      const changes = tx.changes.map((c: any) => ({ from: ed.posToOffset(c.from), to: ed.posToOffset(c.to), text: c.text }));
      changes.sort((a: any, b: any) => b.from - a.from);
      for (const c of changes) ed.value = ed.value.slice(0, c.from) + c.text + ed.value.slice(c.to);
    },
  };
  return ed;
}

function setup(opts: { base: string; revised: string; disk?: string; editor?: any; mode?: 'source' | 'preview' }) {
  const file = Object.assign(new TFile(), { path: 'note.md' });
  const disk = { text: opts.disk ?? opts.base };
  const view = (editor: any) => Object.assign(Object.create(MarkdownView.prototype), { editor, file, getMode: () => opts.mode ?? 'source' });
  const leaves = opts.editor ? [{ view: view(opts.editor) }] : [];
  const app: any = {
    workspace: { getLeavesOfType: jest.fn(() => leaves) },
    vault: {
      getAbstractFileByPath: (p: string) => (p === 'note.md' ? file : null),
      read: jest.fn(async () => disk.text),
      process: jest.fn(async (_f: TFile, fn: (s: string) => string) => { disk.text = fn(disk.text); return disk.text; }),
    },
  };
  const review: EditReviewState = {
    notePath: 'note.md', base: opts.base, request: '고쳐 줘', hunks: buildReviewHunks(opts.base, opts.revised), decisions: {}, status: 'pending',
  };
  const resend = jest.fn();
  const root = el();
  renderEditReviewCard(root, review, { app, onChange: jest.fn(), resend, isBusy: () => false });
  return { root, review, disk, app, resend };
}

describe('EditReviewCard — closed note (file path)', () => {
  it('writes nothing until apply, then only the accepted block', async () => {
    const { root, review, disk, app } = setup({ base: 'a\nb\nc\nd\ne\n', revised: 'A\nb\nc\nd\nE\n' });
    button(root, '✓ 적용', 1).click();
    button(root, '✕ 거부', 0).click();
    expect(app.vault.process).not.toHaveBeenCalled();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(disk.text).toBe('a\nb\nc\nd\nE\n');
    expect(review.status).toBe('applied');
  });

  it('keeps the real file\'s CRLF endings when the base was LF', async () => {
    const { root, disk } = setup({ base: 'a\nb\nc\n', revised: 'a\nB\nc\n', disk: 'a\r\nb\nc\r\n' });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(disk.text).toBe('a\r\nB\nc\r\n');
  });

  it('writes nothing when the student duplicated the target region (T8)', async () => {
    const { root, review, disk } = setup({ base: 'x\nTARGET\ny\n', revised: 'x\nDONE\ny\n', disk: 'TARGET\nx\nTARGET\ny\n' });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(disk.text).toBe('TARGET\nx\nTARGET\ny\n');
    expect(review.status).toBe('pending');
    expect(allText(root)).toContain('새 수정안 받기');
  });
});

describe('EditReviewCard — note open in reading mode (U4a)', () => {
  // Obsidian never saves the hidden editor of a reading-mode tab, so applying there
  // reported "applied" while the file kept its old text (real-Obsidian self-test U4a).
  it('writes the file, not the hidden editor buffer', async () => {
    const editor = fakeEditor('a\nb\n');
    const { root, review, disk } = setup({ base: 'a\nb\n', revised: 'a\nB\n', editor, mode: 'preview' });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(editor.transactions).toBe(0);
    expect(disk.text).toBe('a\nB\n');
    expect(review.status).toBe('applied');
  });

  it('writes nothing when the reading-mode buffer holds text the file does not have yet', async () => {
    const editor = fakeEditor('a\nb\nunsaved');
    const { root, review, disk } = setup({ base: 'a\nb\n', revised: 'a\nB\n', editor, mode: 'preview' });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(editor.transactions).toBe(0);
    expect(disk.text).toBe('a\nb\n');
    expect(review.status).toBe('pending');
  });
});

describe('EditReviewCard — note opened while a file write is pending', () => {
  it('writes nothing when an editor for the note appears before the write lands', async () => {
    const { root, review, disk, app } = setup({ base: 'a\nb\n', revised: 'a\nB\n' });
    const editor = fakeEditor('a\nb\ntyped');
    const file = app.vault.getAbstractFileByPath('note.md');
    app.vault.process = jest.fn(async (_f: TFile, fn: (s: string) => string) => {
      // The student opens the note and types before Obsidian runs the callback.
      app.workspace.getLeavesOfType = () => [{ view: Object.assign(Object.create(MarkdownView.prototype), { editor, file }) }];
      disk.text = fn(disk.text);
      return disk.text;
    });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(disk.text).toBe('a\nb\n');
    expect(review.status).toBe('pending');
    expect(allText(root)).toContain('새 수정안 받기');
  });
});

describe('EditReviewCard — open note (editor path)', () => {
  it('sees unsaved typing: no transaction, no file write, banner shown (T6)', async () => {
    const editor = fakeEditor('a\nb\nc\ntyped');
    const { root, review, app } = setup({ base: 'a\nb\nc\n', revised: 'A\nb\nc\n', disk: 'a\nb\nc\n', editor });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(editor.transactions).toBe(0);
    expect(app.vault.process).not.toHaveBeenCalled();
    expect(editor.value).toBe('a\nb\nc\ntyped');
    expect(review.status).toBe('pending');
    expect(allText(root)).toContain('새 수정안 받기');
  });

  it('applies to an LF buffer of a CRLF note in one transaction and never writes the file (T7)', async () => {
    const editor = fakeEditor('a\nb\n');
    const { root, review, app } = setup({ base: 'a\r\nb\r\n', revised: 'a\nB\n', editor });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(editor.transactions).toBe(1);
    expect(editor.value).toBe('a\nB\n');
    expect(app.vault.process).not.toHaveBeenCalled();
    expect(review.status).toBe('applied');
    expect(allText(root)).toContain('Ctrl/Cmd+Z');
  });

  it('does not report success when the editor ignored the change (T9)', async () => {
    const editor = fakeEditor('a\nb\n', { noop: true });
    const { root, review } = setup({ base: 'a\nb\n', revised: 'a\nB\n', editor });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    expect(review.status).toBe('pending');
    expect(allText(root)).toContain('바뀌지 않았어요');
  });

  it('re-sends the original request from the stale banner', async () => {
    const editor = fakeEditor('changed\n');
    const { root, resend } = setup({ base: 'a\n', revised: 'A\n', editor });
    button(root, '모두 ✓').click();
    button(root, '선택한 변경 적용').click();
    await flush();
    button(root, '새 수정안 받기').click();
    expect(resend).toHaveBeenCalledWith('고쳐 줘');
  });
});

describe('readLiveNote (T10)', () => {
  it('reads the open editor buffer, not the file on disk', async () => {
    const editor = fakeEditor('typed but not saved\n');
    const { app } = setup({ base: 'x\n', revised: 'x\n', disk: 'old on disk\n', editor });
    await expect(readLiveNote(app, 'note.md')).resolves.toBe('typed but not saved\n');
  });

  it('reads the file when the note is not open', async () => {
    const { app } = setup({ base: 'x\n', revised: 'x\n', disk: 'on disk\n' });
    await expect(readLiveNote(app, 'note.md')).resolves.toBe('on disk\n');
  });
});

it('shows a plain notice for a malformed proposal and offers no apply button', () => {
  const root = el();
  renderEditReviewCard(root, { notePath: 'note.md', base: 'a\n', request: 'x', hunks: [], decisions: {}, status: 'malformed' }, { app: {} as any, onChange: jest.fn(), resend: jest.fn(), isBusy: () => false });
  expect(allText(root)).toContain('수정안을 읽지 못했어요');
  expect(button(root, '선택한 변경 적용')).toBeUndefined();
});

// spar 01/02 F3: "applied" used to be judged on the first editor only. Real Obsidian syncs
// the other editors of the same note ~15 ms later (self-test F3c), so wait for every
// editor to show the result before calling it applied.
describe('applyToLiveNote — every open editor of the note', () => {
  function twoEditorApp(second: any) {
    const file = Object.assign(new TFile(), { path: 'note.md' });
    const first = fakeEditor('a\nb\n');
    const view = (editor: any) => Object.assign(Object.create(MarkdownView.prototype), { editor, file, getMode: () => 'source' });
    const app: any = {
      workspace: { getLeavesOfType: () => [{ view: view(first) }, { view: view(second) }] },
      vault: { getAbstractFileByPath: () => file },
    };
    return { app, first };
  }

  it('reports applied once the other editor has synced', async () => {
    const second = fakeEditor('a\nb\n');
    const { app, first } = twoEditorApp(second);
    const origTx = first.transaction;
    first.transaction = (tx: any) => { origTx(tx); setTimeout(() => { second.value = first.value; }, 15); };
    const hunks = buildReviewHunks('a\nb\n', 'a\nB\n');
    await expect(applyToLiveNote(app, 'note.md', 'a\nb\n', hunks, ['h1'])).resolves.toEqual({ kind: 'applied', undoable: true });
  });

  it('asks the student to check the note when another editor never shows the result', async () => {
    const second = fakeEditor('a\nb\n');
    const { app } = twoEditorApp(second);
    const hunks = buildReviewHunks('a\nb\n', 'a\nB\n');
    await expect(applyToLiveNote(app, 'note.md', 'a\nb\n', hunks, ['h1'])).resolves.toEqual({ kind: 'check_note' });
  });
});
