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
 * Folder labels that are long enough to tell the rows apart, and no longer.
 *
 * A fixed number of trailing segments cannot work: this vault holds six
 * `lecture-*` projects whose folders all end `lecture/WeekNN/notes`, so two
 * segments render every one of them identically, while three would be wasted
 * on a shallow vault. Each label grows from the file end only until it is
 * unique among the rows actually on screen.
 *
 * Returns a map from full path to the label for the line under the name.
 */
export function disambiguateFolderLabels(
  paths: readonly string[],
  maxSegments = 4
): Map<string, string> {
  const split = new Map(paths.map((path) => [path, path.split('/').filter(Boolean)]));
  const labels = new Map<string, string>();

  for (const path of paths) {
    const segments = split.get(path) ?? [];
    // The last segment is the name shown above; the label is what precedes it.
    let keep = 2;
    for (; keep <= maxSegments; keep += 1) {
      const mine = suffixOf(segments, keep);
      const collides = paths.some(
        (other) => other !== path && suffixOf(split.get(other) ?? [], keep) === mine
      );
      if (!collides) break;
    }
    keep = Math.min(keep, maxSegments);

    const shown = segments.slice(Math.max(0, segments.length - keep), segments.length - 1);
    const truncated = segments.length - 1 > shown.length;
    labels.set(path, shown.length === 0 ? '' : `${truncated ? '…/' : ''}${shown.join('/')}`);
  }

  return labels;
}

function suffixOf(segments: readonly string[], count: number): string {
  return segments.slice(Math.max(0, segments.length - count)).join('/');
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
