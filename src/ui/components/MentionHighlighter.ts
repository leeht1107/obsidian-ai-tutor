/**
 * Highlights @-mentions inside the chat input.
 *
 * A `<textarea>` cannot style part of its own value, and swapping it for a
 * contenteditable would put Korean IME composition at risk — the one thing this
 * plugin cannot afford to break. So the textarea stays exactly as it is and a
 * backdrop is painted behind it: same text, same metrics, but with the mention
 * runs given a background. The student sees the file names highlighted and can
 * tell an @-mention that registered from one they merely typed.
 */

import { buildMentionSegments } from '../../utils/mentionDisplay';

export class MentionHighlighter {
  private readonly backdrop: HTMLElement;
  private readonly onInput = () => this.refresh();
  private readonly onScroll = () => this.syncScroll();
  private valuePatched = false;

  constructor(
    private readonly wrapper: HTMLElement,
    private readonly input: HTMLTextAreaElement
  ) {
    this.backdrop = wrapper.createDiv({ cls: 'ocop-mention-backdrop' });
    // Behind the textarea in paint order regardless of where createDiv put it.
    wrapper.insertBefore(this.backdrop, input);
    input.addClass('ocop-input-highlighted');

    input.addEventListener('input', this.onInput);
    input.addEventListener('scroll', this.onScroll);
    this.watchProgrammaticWrites();
    this.refresh();
  }

  /**
   * Setting `.value` in code fires no 'input' event, and roughly a dozen call
   * sites do exactly that — sending, clearing, restoring a draft, accepting a
   * mention from the dropdown. Rather than asking every one of them to
   * remember a refresh, the instance's own accessor is wrapped so the backdrop
   * follows the value wherever it is set from.
   */
  private watchProgrammaticWrites(): void {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(this.input) as object,
      'value'
    );
    if (!descriptor?.get || !descriptor?.set) return;
    const { get, set } = descriptor;
    Object.defineProperty(this.input, 'value', {
      configurable: true,
      enumerable: true,
      get: () => get.call(this.input) as string,
      set: (next: string) => {
        set.call(this.input, next);
        this.refresh();
      },
    });
    this.valuePatched = true;
  }

  /** Rebuild the backdrop. Call after setting `input.value` in code. */
  refresh(): void {
    this.backdrop.empty();
    for (const segment of buildMentionSegments(this.input.value)) {
      if (segment.isMention) {
        this.backdrop.createSpan({ cls: 'ocop-mention-inline', text: segment.text });
      } else {
        // createSpan, not raw text: keeps every run a node so nothing is parsed
        // as markup on the way in.
        this.backdrop.createSpan({ text: segment.text });
      }
    }
    this.syncScroll();
  }

  private syncScroll(): void {
    this.backdrop.scrollTop = this.input.scrollTop;
    this.backdrop.scrollLeft = this.input.scrollLeft;
  }

  destroy(): void {
    this.input.removeEventListener('input', this.onInput);
    this.input.removeEventListener('scroll', this.onScroll);
    // Hand `.value` back to the prototype accessor.
    if (this.valuePatched) delete (this.input as Partial<HTMLTextAreaElement>).value;
    this.backdrop.remove();
  }
}
