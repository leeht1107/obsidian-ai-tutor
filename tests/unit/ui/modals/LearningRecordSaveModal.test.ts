/**
 * The editable save preview must not accept a note that would no longer be a learning record,
 * and must say why while staying open.
 */
import { LearningRecordSaveModal } from '@/ui/modals/LearningRecordSaveModal';

const VALID = '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "lr-1"\n---\n\n# 기록\n';

interface Opts { text?: string; cls?: string }
interface FakeEl {
  tag: string;
  cls?: string;
  text: string;
  value: string;
  disabled: boolean;
  children: FakeEl[];
  handlers: Record<string, Array<() => void>>;
  createEl(tag: string, opts?: Opts): FakeEl;
  createDiv(opts?: Opts): FakeEl;
  createSpan(opts?: Opts): FakeEl;
  addEventListener(event: string, handler: () => void): void;
  setText(text: string): void;
  empty(): void;
  addClass(): void;
}

function fakeEl(tag = 'div', opts: Opts = {}): FakeEl {
  const el: FakeEl = {
    tag, cls: opts.cls, text: opts.text ?? '', value: '', disabled: false, children: [], handlers: {},
    createEl: (childTag, o) => { const child = fakeEl(childTag, o); el.children.push(child); return child; },
    createDiv: (o) => el.createEl('div', o),
    createSpan: (o) => el.createEl('span', o),
    addEventListener: (event, handler) => { (el.handlers[event] ??= []).push(handler); },
    setText: (text) => { el.text = text; },
    empty: () => { el.children = []; },
    addClass: () => undefined,
  };
  return el;
}

function find(root: FakeEl, pred: (el: FakeEl) => boolean): FakeEl[] {
  return [root, ...root.children.flatMap((child) => find(child, pred))].filter(pred);
}

function open(markdown = VALID) {
  const modal = new LearningRecordSaveModal({} as any, { folder: '.ai-tutor/learning-records', fileName: 'x', markdown });
  const content = fakeEl();
  (modal as any).contentEl = content;
  (modal as any).modalEl = fakeEl();
  (modal as any).setTitle = jest.fn();
  let settled: unknown = 'pending';
  const waiting = modal.openAndWait().then((choice) => { settled = choice; });
  // The obsidian mock puts an own jest.fn() on onOpen; run the real method.
  LearningRecordSaveModal.prototype.onOpen.call(modal);
  const area = find(content, (e) => e.tag === 'textarea')[0];
  const confirm = find(content, (e) => Boolean(e.cls?.includes('ocop-save-btn')))[0];
  const type = (value: string) => { area.value = value; area.handlers.input.forEach((h) => h()); };
  const click = () => confirm.handlers.click.forEach((h) => h());
  const texts = () => find(content, () => true).map((e) => e.text).join('\n');
  return { modal, area, confirm, type, click, texts, settled: () => settled, waiting };
}

describe('LearningRecordSaveModal metadata guard', () => {
  it('positive control: the generated record saves with exactly the shown bytes', async () => {
    const m = open();
    m.click();
    await m.waiting;
    expect(m.settled()).toEqual({ fileName: 'x', markdown: VALID });
    expect(m.modal.close).toHaveBeenCalled();
  });

  it.each([
    ['recordId', VALID.replace('recordId: "lr-1"\n', '')],
    ['머리말', '# 본문만 남김'],
    ['type', VALID.replace('type: ai-tutor-learning-record\n', '')],
  ])('keeps the modal open with a concrete error when %s is gone', async (_name, edited) => {
    const m = open();
    m.type(edited);
    expect(m.confirm.disabled).toBe(true);
    expect(m.texts()).toContain('학습 기록');
    m.click();
    expect(m.settled()).toBe('pending');
    expect(m.modal.close).not.toHaveBeenCalled();
  });

  it('lets the student repair the metadata and then save the repaired bytes', async () => {
    const m = open();
    m.type('# 본문만 남김');
    expect(m.confirm.disabled).toBe(true);
    m.type(VALID);
    expect(m.confirm.disabled).toBe(false);
    m.click();
    await m.waiting;
    expect(m.settled()).toEqual({ fileName: 'x', markdown: VALID });
  });

  it('refuses to confirm even if the button state was bypassed', () => {
    const m = open();
    m.type('# 본문만 남김');
    m.confirm.disabled = false;
    m.click();
    expect(m.settled()).toBe('pending');
    expect(m.modal.close).not.toHaveBeenCalled();
  });
});
