import { MentionHighlighter } from '@/ui/components/MentionHighlighter';

/**
 * The chat input is a textarea, which cannot style part of its own value, so a
 * backdrop behind it carries the highlight. These pin the two things that make
 * that illusion hold: the mirrored text must equal the value exactly, and the
 * backdrop must follow a value that code assigns without firing an input event.
 *
 * The textarea mock keeps `value` as a prototype accessor because that is what
 * the component wraps — a plain data property would let the test pass while the
 * real patch did nothing.
 */
class MockElement {
  className = '';
  text = '';
  children: MockElement[] = [];
  scrollTop = 0;
  scrollLeft = 0;
  removed = false;

  createDiv(options?: { cls?: string; text?: string }): MockElement {
    return this.append(options);
  }

  createSpan(options?: { cls?: string; text?: string }): MockElement {
    return this.append(options);
  }

  private append(options?: { cls?: string; text?: string }): MockElement {
    const child = new MockElement();
    child.className = options?.cls ?? '';
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }

  empty(): void { this.children = []; }
  remove(): void { this.removed = true; }
  insertBefore(child: MockElement, _before: unknown): MockElement { return child; }

  /** Concatenated text of every descendant, i.e. what the student would see. */
  get textContent(): string {
    return this.children.map((c) => c.text + c.textContent).join('');
  }

  find(cls: string): MockElement[] {
    const hits = this.children.filter((c) => c.className.split(' ').includes(cls));
    return [...hits, ...this.children.flatMap((c) => c.find(cls))];
  }
}

class MockTextarea extends MockElement {
  private internal = '';
  scrollTop = 0;
  scrollLeft = 0;
  listeners: Record<string, (() => void)[]> = {};

  get value(): string { return this.internal; }
  set value(next: string) { this.internal = next; }

  addClass(cls: string): void { this.className = `${this.className} ${cls}`.trim(); }
  addEventListener(type: string, handler: () => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  removeEventListener(type: string, handler: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((h) => h !== handler);
  }
}

function setup() {
  const wrapper = new MockElement();
  const input = new MockTextarea();
  const highlighter = new MentionHighlighter(wrapper as never, input as never);
  const backdrop = () => wrapper.children.find((c) => c.className === 'ocop-mention-backdrop')!;
  return { wrapper, input, highlighter, backdrop };
}

describe('MentionHighlighter', () => {
  it('highlights only the @-mention runs', () => {
    const { input, highlighter, backdrop } = setup();
    input.value = '보고 @Week01.md 정리해줘';

    expect(backdrop().find('ocop-mention-inline').map((el) => el.text)).toEqual(['@Week01.md']);
    highlighter.destroy();
  });

  it('mirrors the value exactly, so the highlight cannot drift off the words', () => {
    const { input, highlighter, backdrop } = setup();
    input.value = '@Week01_notes_compiled.md  @BOARD.md 정리';

    expect(backdrop().textContent).toBe(input.value);
    highlighter.destroy();
  });

  it('follows a value set from code, which fires no input event', () => {
    // Sending, clearing and accepting a mention all assign .value directly.
    const { input, highlighter, backdrop } = setup();

    input.value = '@BOARD.md 요약해줘';

    expect(backdrop().textContent).toBe('@BOARD.md 요약해줘');
    expect(backdrop().find('ocop-mention-inline')).toHaveLength(1);
    highlighter.destroy();
  });

  it('clears the backdrop when the input is emptied after sending', () => {
    const { input, highlighter, backdrop } = setup();
    input.value = '@BOARD.md';

    input.value = '';

    expect(backdrop().textContent).toBe('');
    expect(backdrop().find('ocop-mention-inline')).toHaveLength(0);
    highlighter.destroy();
  });

  it('does not mark an email address as a mention', () => {
    const { input, highlighter, backdrop } = setup();
    input.value = 'mark@example.com 으로 보내줘';

    expect(backdrop().find('ocop-mention-inline')).toHaveLength(0);
    highlighter.destroy();
  });

  it('gives the textarea its own value accessor back on destroy', () => {
    const { input, highlighter, wrapper } = setup();

    highlighter.destroy();

    expect(Object.getOwnPropertyDescriptor(input, 'value')).toBeUndefined();
    input.value = 'still works';
    expect(input.value).toBe('still works');
    expect(wrapper.children.find((c) => c.className === 'ocop-mention-backdrop')?.removed).toBe(true);
  });

  it('stops mirroring once destroyed', () => {
    const { input, highlighter, backdrop } = setup();
    const el = backdrop();
    highlighter.destroy();

    input.value = '@later.md';

    expect(el.textContent).toBe('');
  });
});
