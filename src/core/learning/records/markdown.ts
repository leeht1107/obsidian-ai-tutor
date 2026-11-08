import type { LearningRecordMode, LearningRecordOrigin, LearningRecordSummary } from './types';
import { LEARNING_RECORD_FORMAT_VERSION, MAX_RECORD_FILE_BYTES } from './types';

export const RECORD_TYPE = 'ai-tutor-learning-record';

export interface RecordFrontmatter {
  recordId: string;
  saveIntentId: string;
  createdAt: string;
  mode: LearningRecordMode;
  origin: LearningRecordOrigin;
  sourcePaths: string[];
  sourceConversationId: string;
  completionMessageId: string;
  remainingQuestions: number;
}

/** Descriptive header only. None of these fields grants read, write, tool or grading authority. */
export function buildFrontmatter(meta: RecordFrontmatter): string {
  return [
    '---',
    `type: ${RECORD_TYPE}`,
    `formatVersion: ${LEARNING_RECORD_FORMAT_VERSION}`,
    `recordId: ${JSON.stringify(meta.recordId)}`,
    `saveIntentId: ${JSON.stringify(meta.saveIntentId)}`,
    `createdAt: ${JSON.stringify(meta.createdAt)}`,
    `mode: ${meta.mode}`,
    `origin: ${meta.origin}`,
    `sourcePaths: ${JSON.stringify(meta.sourcePaths)}`,
    `sourceConversationId: ${JSON.stringify(meta.sourceConversationId)}`,
    `completionMessageId: ${JSON.stringify(meta.completionMessageId)}`,
    `remainingQuestions: ${Math.max(0, Math.floor(meta.remainingQuestions))}`,
    '---',
  ].join('\n');
}

function splitFrontmatter(text: string): { fields: Map<string, string>; body: string } | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return null;
  const fields = new Map<string, string>();
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (match && !fields.has(match[1])) fields.set(match[1], match[2].trim());
  }
  const rest = normalized.slice(end + 4);
  return { fields, body: rest.startsWith('\n') ? rest.slice(1) : rest };
}

function parseJsonString(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function parseStringArray(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Reads the header of a possible record. Anything that is not exactly this format stays an
 * ordinary note (null): a student-edited or imported file is reference text, never authority.
 */
export function parseRecordSummary(path: string, text: string, size: number): Omit<LearningRecordSummary, 'duplicatePaths'> | null {
  const parts = splitFrontmatter(text);
  if (!parts) return null;
  const { fields, body } = parts;
  if (fields.get('type') !== RECORD_TYPE) return null;
  if (Number(fields.get('formatVersion')) !== LEARNING_RECORD_FORMAT_VERSION) return null;
  const recordId = parseJsonString(fields.get('recordId'));
  if (!recordId) return null;
  const mode = fields.get('mode');
  const heading = /^#\s+(.+)$/m.exec(body);
  const remaining = Number(fields.get('remainingQuestions'));
  return {
    path,
    recordId,
    title: heading ? heading[1].trim() : path.split('/').pop()?.replace(/\.md$/i, '') ?? path,
    mode: mode === 'quiz' || mode === 'socratic' ? mode : 'unknown',
    createdAt: parseJsonString(fields.get('createdAt')) ?? '',
    sourcePaths: parseStringArray(fields.get('sourcePaths')),
    remainingQuestions: Number.isFinite(remaining) && remaining > 0 ? Math.floor(remaining) : 0,
    size,
  };
}

/**
 * Why `text` would not be found again as a record (null when it would): the same checks as
 * `parseRecordSummary`, plus the size cap discovery applies. Used before anything is written.
 */
export function recordProblem(text: string): string | null {
  const parts = splitFrontmatter(text);
  if (!parts) return '맨 위의 --- 머리말이 없습니다';
  if (parts.fields.get('type') !== RECORD_TYPE) return `type: ${RECORD_TYPE} 줄이 없습니다`;
  if (Number(parts.fields.get('formatVersion')) !== LEARNING_RECORD_FORMAT_VERSION) {
    return `formatVersion: ${LEARNING_RECORD_FORMAT_VERSION} 줄이 없습니다`;
  }
  if (!parseJsonString(parts.fields.get('recordId'))) return 'recordId 줄이 없거나 "따옴표" 문자열이 아닙니다';
  if (new TextEncoder().encode(text).length > MAX_RECORD_FILE_BYTES) return '내용이 너무 커서 다시 찾을 수 없습니다';
  return null;
}

/** Whether `text` is a record carrying exactly this id (used by exact-target reconciliation). */
export function recordIdOf(text: string): string | null {
  const parts = splitFrontmatter(text);
  if (!parts || parts.fields.get('type') !== RECORD_TYPE) return null;
  return parseJsonString(parts.fields.get('recordId'));
}

export function stripRecordFrontmatter(text: string): string {
  return splitFrontmatter(text)?.body ?? text.replace(/\r\n/g, '\n');
}

/**
 * Continue needs unfinished quiz questions. A learner-written memo under "다시 볼 것 / 스스로 점검"
 * stays in the file and Review rereads it, but it never enables Continue.
 */
export function canContinueRecord(summary: Pick<LearningRecordSummary, 'remainingQuestions'>): boolean {
  return summary.remainingQuestions > 0;
}
