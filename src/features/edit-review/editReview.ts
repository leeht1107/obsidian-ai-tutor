/**
 * Agent-mode edit review: the CLI runs read-only and answers with a whole revised note
 * between two marker lines; the plugin turns that into hunks the student accepts or
 * rejects one by one, and writes only the accepted ones.
 *
 * All line numbers here are 0-based indexes into the ORIGINAL note's lines. Hunks never
 * overlap in those coordinates, so any subset can be applied independently.
 */
import type { EditReviewState, ReviewHunk } from '../../core/types/chat';
import { shouldSkipLineDiff } from '../../ui/renderers/DiffRenderer';

export type { ReviewHunk };

export const EDIT_PROPOSAL_BEGIN = '<<<REVISED_NOTE>>>';
export const EDIT_PROPOSAL_END = '<<<END_REVISED_NOTE>>>';


export type ExtractedProposal =
  | { kind: 'none' }
  | { kind: 'malformed' }
  | { kind: 'proposal'; revised: string; displayText: string };

/** The instruction prepended to an Agent-mode turn. Wording measured 40/40 across four CLIs. */
export function buildEditProposalInstruction(notePath: string): string {
  return [
    '<edit_review>',
    `You are helping a student with the note "${notePath}". Do not edit files and do not use tools that write.`,
    'If the request asks to change this note, reply with a short summary of the changes, then the COMPLETE revised note,',
    `exactly once, between a line ${EDIT_PROPOSAL_BEGIN} and a line ${EDIT_PROPOSAL_END}.`,
    'Copy every line you do not need to change exactly as it is. Put nothing else inside the markers.',
    'If the request does not ask to change the note, answer normally and do not write the markers.',
    'The student reviews each changed block and only accepted blocks are written to the note.',
    '</edit_review>',
  ].join('\n');
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Finds the one revised note in an answer. Two proposals or a broken pair is malformed. */
export function extractEditProposal(answer: string): ExtractedProposal {
  const begins = count(answer, EDIT_PROPOSAL_BEGIN);
  const ends = count(answer, EDIT_PROPOSAL_END);
  if (begins === 0 && ends === 0) return { kind: 'none' };
  const start = answer.indexOf(EDIT_PROPOSAL_BEGIN);
  const end = answer.indexOf(EDIT_PROPOSAL_END);
  if (begins !== 1 || ends !== 1 || end < start) return { kind: 'malformed' };
  // The marker lines own their line breaks; the note body is what lies between them.
  const revised = answer.slice(start + EDIT_PROPOSAL_BEGIN.length, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  const outside = [answer.slice(0, start).trim(), answer.slice(end + EDIT_PROPOSAL_END.length).trim()];
  return { kind: 'proposal', revised, displayText: outside.filter(Boolean).join('\n\n') };
}

type LineEnding = '\r\n' | '\n' | '';

/** Lines without their terminators, each line's own terminator, and the note's first terminator. */
interface NoteLines { lines: string[]; endings: LineEnding[]; eol: '\r\n' | '\n' }

function splitNote(text: string): NoteLines {
  const lines: string[] = [];
  const endings: LineEnding[] = [];
  const pattern = /\r?\n/g;
  let from = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    lines.push(text.slice(from, match.index));
    endings.push(match[0] as LineEnding);
    from = match.index + match[0].length;
  }
  if (from < text.length) {
    lines.push(text.slice(from));
    endings.push('');
  }
  return { lines, endings, eol: (endings.find((e) => e !== '') as '\r\n' | '\n' | undefined) ?? '\n' };
}

/** True when the note pair is too large for the line diff to run in reasonable time. */
export function isTooLargeToReview(original: string, revised: string): boolean {
  return shouldSkipLineDiff(original, revised);
}

type DiffOp = { type: 'equal' | 'delete' | 'insert'; text: string };

/**
 * Line LCS walked from the top, taking a matching line as early as it can. The shared
 * computeLineDiff walks from the bottom, which on ties (blank lines) glues two separate
 * edits into one hunk; that would force the student to accept both or neither.
 */
function forwardLineDiff(a: string[], b: string[]): DiffOp[] {
  const m = a.length;
  const n = b.length;
  // suffix[i][j] = LCS length of a[i..] and b[j..]
  const suffix: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      suffix[i][j] = a[i] === b[j] ? suffix[i + 1][j + 1] + 1 : Math.max(suffix[i + 1][j], suffix[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      ops.push({ type: 'equal', text: a[i] }); i++; j++;
    } else if (j < n && (i === m || suffix[i][j + 1] >= suffix[i + 1][j])) {
      ops.push({ type: 'insert', text: b[j] }); j++;
    } else {
      ops.push({ type: 'delete', text: a[i] }); i++;
    }
  }
  return ops;
}

/** Groups the line diff into hunks. Runs of changed lines separated by an unchanged line stay apart. */
export function buildReviewHunks(original: string, revised: string): ReviewHunk[] {
  const oldLines = splitNote(original).lines;
  const newLines = splitNote(revised).lines;
  const hunks: ReviewHunk[] = [];
  let oldIndex = 0;
  let current: ReviewHunk | null = null;
  for (const line of forwardLineDiff(oldLines, newLines)) {
    if (line.type === 'equal') {
      current = null;
      oldIndex += 1;
      continue;
    }
    if (!current) {
      current = { id: `h${hunks.length + 1}`, oldStart: oldIndex, oldLines: [], newLines: [] };
      hunks.push(current);
    }
    if (line.type === 'delete') {
      current.oldLines.push(line.text);
      oldIndex += 1;
    } else {
      current.newLines.push(line.text);
    }
  }
  return hunks;
}

/**
 * Applies the accepted hunks to `original`. Untouched lines keep their own terminators (a
 * note may mix CRLF and LF); a replacement takes the terminator of the line it replaces,
 * an insert the one of the line above it; the note keeps its final newline or lack of one.
 */
export function applyReviewHunks(original: string, hunks: ReviewHunk[], acceptedIds: readonly string[]): string {
  const note = splitNote(original);
  const rows = note.lines.map((text, i) => ({ text, end: note.endings[i], added: false }));
  const finalEnding: LineEnding = note.endings.length > 0 ? note.endings[note.endings.length - 1] : '';
  const accepted = hunks
    .filter((h) => acceptedIds.includes(h.id))
    .sort((a, b) => b.oldStart - a.oldStart); // bottom-up keeps earlier indexes valid
  for (const h of accepted) {
    const inherited = h.oldLines.length > 0 ? rows[h.oldStart]?.end : rows[h.oldStart - 1]?.end;
    const end: LineEnding = inherited || note.eol;
    rows.splice(h.oldStart, h.oldLines.length, ...h.newLines.map((text) => ({ text, end, added: true })));
  }
  return rows.map((row, i) => {
    // Only an added line at the very end takes the note's final ending; an untouched line
    // keeps its own, except that a line which had none needs one once a line follows it.
    if (i === rows.length - 1 && row.added) return row.text + finalEnding;
    if (i === rows.length - 1) return row.text + row.end;
    return row.text + (row.end || note.eol);
  }).join('');
}


/** Same note text, treating CRLF and LF as equal. A lone CR still differs, so it fails closed. */
export function sameNote(a: string, b: string): boolean {
  return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

export interface OffsetChange { from: number; to: number; text: string }

/**
 * Editor changes for the accepted hunks of an LF `base`, one per hunk, in pre-change
 * offsets and bottom-up order, so they are right whether the editor applies them at once
 * or one after another. Untouched lines are not part of any change.
 */
export function toEditorChanges(base: string, hunks: ReviewHunk[], acceptedIds: readonly string[]): OffsetChange[] {
  const { lines, endings } = splitNote(base);
  const finalNewline = endings.length > 0 && endings[endings.length - 1] !== '';
  const starts: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    starts.push(offset);
    offset += lines[i].length + endings[i].length;
  }
  const startOf = (i: number) => (i < lines.length ? starts[i] : base.length);
  return hunks
    .filter((h) => acceptedIds.includes(h.id))
    .sort((a, b) => b.oldStart - a.oldStart)
    .map((h) => {
      const end = h.oldStart + h.oldLines.length;
      if (end < lines.length || finalNewline) {
        return { from: startOf(h.oldStart), to: startOf(end), text: h.newLines.map((l) => `${l}\n`).join('') };
      }
      // The range reaches the end of a note without a final newline.
      if (h.oldLines.length === 0) {
        return { from: base.length, to: base.length, text: (base === '' ? '' : '\n') + h.newLines.join('\n') };
      }
      return { from: startOf(h.oldStart), to: base.length, text: h.newLines.join('\n') };
    });
}

export const PROPOSAL_FALLBACK_TEXT = '수정안을 만들었어요. 아래에서 블록마다 확인해 주세요.';

/**
 * Reads a finished answer into an `awaiting` review. Returns the text to show in place of
 * the answer (the note copy is hidden behind the review card), or null to show the answer
 * unchanged. An answer without markers leaves the review `awaiting`; the caller drops it.
 */
export function readProposalIntoReview(review: EditReviewState, answer: string): string | null {
  if (review.status !== 'awaiting') return null;
  const extracted = extractEditProposal(answer);
  if (extracted.kind === 'none') return null;
  if (extracted.kind === 'malformed') {
    review.status = 'malformed';
    return null;
  }
  if (isTooLargeToReview(review.base, extracted.revised)) {
    review.status = 'too_large';
    return extracted.displayText || PROPOSAL_FALLBACK_TEXT;
  }
  review.hunks = buildReviewHunks(review.base, extracted.revised);
  review.status = 'pending';
  return extracted.displayText || PROPOSAL_FALLBACK_TEXT;
}
