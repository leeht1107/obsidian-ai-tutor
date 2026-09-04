/** Presentation helpers for @-mentions. Kept pure so the cases can be pinned without a DOM. */

/**
 * Splits a vault path into the file name and its folders. The dropdown used to print the
 * whole path on one ellipsised line, which in a narrow sidebar cut off the file name —
 * the one part the user is actually scanning for.
 */
export function splitMentionPath(rawPath: string): { name: string; folder: string } {
  const normalized = rawPath.replace(/\\/g, '/').trim().replace(/\/+$/, '');
  if (!normalized) return { name: '', folder: '' };
  const cut = normalized.lastIndexOf('/');
  if (cut < 0) return { name: normalized, folder: '' };
  return { name: normalized.slice(cut + 1), folder: normalized.slice(0, cut) };
}

export interface MentionRange { start: number; end: number }

// Same shape the input transformer accepts: @"quoted name", @'quoted', or @path.ext.
// The leading boundary keeps an email address from matching.
const MENTION = /(^|[^\w@])@(?:"([^"]+)"|'([^']+)'|([^\s"']+\.\w+))/g;

/** Locates every @-mention in a message so it can be marked up as context, not prose. */
export function findMentionRanges(text: string): MentionRange[] {
  const ranges: MentionRange[] = [];
  for (const match of text.matchAll(MENTION)) {
    const lead = match[1] ?? '';
    const start = (match.index ?? 0) + lead.length;
    ranges.push({ start, end: start + (match[0].length - lead.length) });
  }
  return ranges;
}

/**
 * Wraps every @-mention already rendered inside `root` in a chip span, so a sent message
 * shows at a glance which files went along with it. Walks text nodes only, leaving links
 * and code spans that markdown produced untouched.
 */
export function markMentions(root: HTMLElement | null | undefined): void {
  if (!root) return;
  const doc = root.ownerDocument;
  if (!doc) return;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest('code, pre, a, .ocop-mention-chip')) continue;
    if (findMentionRanges(text.data).length > 0) targets.push(text);
  }
  for (const text of targets) {
    const ranges = findMentionRanges(text.data);
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const range of ranges) {
      if (range.start > cursor) fragment.appendChild(doc.createTextNode(text.data.slice(cursor, range.start)));
      const chip = doc.createElement('span');
      chip.className = 'ocop-mention-chip';
      chip.textContent = text.data.slice(range.start, range.end);
      fragment.appendChild(chip);
      cursor = range.end;
    }
    if (cursor < text.data.length) fragment.appendChild(doc.createTextNode(text.data.slice(cursor)));
    text.parentNode?.replaceChild(fragment, text);
  }
}
