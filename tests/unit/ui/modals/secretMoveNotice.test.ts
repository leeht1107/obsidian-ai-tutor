/**
 * The one-time notice is shown only to students who already had a credential in
 * the vault settings file — which is exactly the population whose token may
 * already sit in a OneDrive version history, a Dropbox snapshot or a Git commit.
 * Moving the file's copy out today does not reach any of those, so the notice
 * has to say so and name the only remedy that does: rotate the credential.
 */
import { SecretMoveNoticeModal } from '@/ui/modals/SecretMoveNoticeModal';

/**
 * Two things about the obsidian mock shape this helper. Its `contentEl` is a bag
 * of jest.fn()s with no DOM behind it, so the copy has to be read off the
 * createEl calls rather than off textContent. And its `Modal` declares `onOpen`
 * as an instance field, which shadows the subclass's prototype method — calling
 * `modal.onOpen()` would run the mock's no-op and see an empty modal.
 */
function renderedText(): string {
  const texts: string[] = [];
  const el = {
    empty: () => undefined,
    createEl: (_tag: string, opts?: { text?: string }) => {
      if (opts?.text) texts.push(opts.text);
      return el;
    },
    createDiv: () => el,
    addClass: () => undefined,
    setText: () => undefined,
    addButton: () => undefined,
  };
  const modal = new SecretMoveNoticeModal({} as never);
  (modal as unknown as { contentEl: unknown }).contentEl = el;
  SecretMoveNoticeModal.prototype.onOpen.call(modal);
  return texts.join('\n');
}

describe('SecretMoveNoticeModal', () => {
  it('keeps the second-machine warning, which students read as the plugin breaking', () => {
    expect(renderedText()).toContain('다른 컴퓨터');
  });

  it('tells the student to rotate a credential that already synced out', () => {
    const text = renderedText();
    expect(text).toContain('재발급');
    // Not merely "it will not sync from now on" — the past copies are the risk.
    expect(text).toMatch(/이전|지금까지|과거/);
  });
});
