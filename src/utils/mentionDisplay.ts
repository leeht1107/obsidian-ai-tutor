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

/**
 * Shortens a folder path from the FRONT.
 *
 * The folder line is a single ellipsised row, and CSS cuts the tail — which
 * removes the folder immediately containing the file and keeps the top-level
 * one every path shares. In a vault like `01. Projects/연구_.../program` that
 * left every candidate looking identical. Dropping the distant ancestors
 * instead keeps the part that tells them apart; the full path stays in the
 * element's tooltip.
 */
export function formatMentionFolder(folder: string, keepSegments = 2): string {
  const segments = folder.split('/').filter(Boolean);
  if (segments.length <= keepSegments) return segments.join('/');
  return `…/${segments.slice(-keepSegments).join('/')}`;
}

/**
 * The folder line shown under a mention's name: the full vault-relative path.
 *
 * Three shortening rules were tried and each failed on this vault. A fixed
 * number of trailing segments hid the subject, since every lecture project ends
 * `lecture/WeekNN/notes`. Growing the label until it was unique among the rows
 * on screen collapsed once the rows all came from one subject. Growing it until
 * a folder name looked rare picked `2026_1`, which occurs three times and means
 * nothing, while the subject folder occurs three times and means everything —
 * frequency cannot tell those apart.
 *
 * So nothing is hidden. The path is returned whole and the line is allowed to
 * wrap to two lines; students organise their vaults differently and the depth
 * that identifies a subject is not something this can infer.
 */
export function folderLabelFor(folderPath: string): string {
  return folderPath;
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

export interface MentionSegment { text: string; isMention: boolean }

/**
 * Splits raw input into plain runs and @-mention runs.
 *
 * A textarea cannot style part of its own value, so the input box paints these
 * segments onto a backdrop sitting behind it. Concatenating every `text` back
 * together must reproduce the input exactly, or the highlight drifts out of
 * alignment with the characters the student is actually typing.
 */
export function buildMentionSegments(text: string): MentionSegment[] {
  if (!text) return [];
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const range of findMentionRanges(text)) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), isMention: false });
    }
    segments.push({ text: text.slice(range.start, range.end), isMention: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), isMention: false });
  return segments;
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
