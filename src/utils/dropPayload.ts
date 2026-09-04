/**
 * Reads what a drag actually carried, so a dropped note can become chat context.
 *
 * Two shapes arrive here. Obsidian's own file explorer drags text — a wikilink, a markdown
 * link, an `obsidian://` url, or a bare path — while a drag from the OS carries File objects.
 * Images are deliberately left out: those already become attachments.
 *
 * Returns raw references, not resolved paths. Matching them against the vault is the
 * caller's job, which is what keeps this function pure and testable.
 */

/** The slice of DataTransfer this reader needs. */
export interface DropPayload {
  types?: readonly string[];
  getData?(type: string): string;
  files?: ArrayLike<{ name: string; type?: string; path?: string }>;
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
// A bare line only counts as a reference if it looks like a path or a note name,
// otherwise dropped prose would be attached as if it were a file.
const BARE_REFERENCE = /^[\w.\-가-힣][\w./\-\s가-힣]*$/;

function isImage(file: { name: string; type?: string }): boolean {
  if (file.type?.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i.test(file.name);
}

/** `[[path|alias]]` and `[[path#heading]]` both point at `path`. */
function stripWikilinkDecoration(target: string): string {
  return target.split('|')[0].split('#')[0].trim();
}

function fromObsidianUrl(line: string): string | null {
  if (!line.startsWith('obsidian://')) return null;
  const file = /[?&]file=([^&]+)/.exec(line);
  if (!file) return null;
  try { return decodeURIComponent(file[1]); } catch { return file[1]; }
}

/**
 * Whether a drag in progress carries something this chat box can take. Obsidian's own
 * file-explorer drag carries only text, so keying the overlay on `Files` alone left an
 * internal note drag with no visible drop affordance at all.
 */
export function dropCarriesAttachable(types: readonly string[] | undefined | null): boolean {
  if (!types) return false;
  return types.includes('Files') || types.includes('text/plain') || types.includes('text/uri-list');
}

export function readDroppedVaultRefs(payload: DropPayload | null | undefined): string[] {
  if (!payload) return [];
  const refs: string[] = [];
  const push = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && !refs.includes(trimmed)) refs.push(trimmed);
  };

  // A Finder drag usually carries both a file and its name as text. The file is the more
  // precise reference, so when any file is present the text is not consulted at all.
  const files = payload.files;
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file || isImage(file)) continue;
      push(file.path || file.name);
    }
    return refs;
  }

  const text = payload.getData?.('text/plain') ?? '';
  if (!text.trim()) return refs;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const url = fromObsidianUrl(trimmed);
    if (url) { push(url); continue; }

    let matched = false;
    for (const match of trimmed.matchAll(WIKILINK)) {
      push(stripWikilinkDecoration(match[1]));
      matched = true;
    }
    for (const match of trimmed.matchAll(MARKDOWN_LINK)) {
      push(match[1]);
      matched = true;
    }
    if (matched) continue;

    // Bare text only counts when it reads like a path or a note name.
    if (!BARE_REFERENCE.test(trimmed)) continue;
    if (trimmed.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(trimmed)) push(trimmed);
  }
  return refs;
}
