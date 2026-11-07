import { toRecordBody } from './context';
import type { RecordFs } from './fs';
import { canContinueRecord, parseRecordSummary } from './markdown';
import { normalizeVaultPath } from './paths';
import type { LearningRecordBody, LearningRecordSummary } from './types';
import { MAX_RECORD_FILE_BYTES } from './types';

export interface RecordInventory {
  records: LearningRecordSummary[];
}

/** Every Markdown file under `folder`. Each folder is visited once, so a listing loop still ends. */
async function listMarkdownRecursive(fs: RecordFs, folder: string): Promise<string[]> {
  const files: string[] = [];
  const visited = new Set<string>();
  const pending = [folder];
  while (pending.length > 0) {
    const current = pending.shift() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!(await fs.exists(current))) continue;
    const listing = await fs.list(current);
    files.push(...listing.files.filter((file) => /\.md$/i.test(file)));
    pending.push(...listing.folders);
  }
  return files;
}

/**
 * Actual files are the inventory. Hidden folders are listed through the adapter, so this does
 * not depend on the vault index. Files that are not exactly this format stay ordinary notes.
 */
export async function discoverRecords(fs: RecordFs, folder: string): Promise<RecordInventory> {
  const root = normalizeVaultPath(folder);
  if (!root) return { records: [] };
  const files = await listMarkdownRecursive(fs, root);
  const parsed: Omit<LearningRecordSummary, 'duplicatePaths'>[] = [];
  for (const path of files.sort()) {
    try {
      const stat = await fs.stat(path);
      if (stat && stat.size > MAX_RECORD_FILE_BYTES) continue;
      const text = await fs.read(path);
      const summary = parseRecordSummary(path, text, stat?.size ?? text.length);
      if (summary) parsed.push(summary);
    } catch {
      // An unreadable file is simply not a usable record.
    }
  }
  const byId = new Map<string, string[]>();
  for (const record of parsed) byId.set(record.recordId, [...(byId.get(record.recordId) ?? []), record.path]);
  const records = parsed.map((record) => ({
    ...record,
    duplicatePaths: (byId.get(record.recordId) ?? []).filter((path) => path !== record.path),
  }));
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.path.localeCompare(b.path));
  return { records };
}

/** Reads one explicitly chosen record fresh from disk; null when it is gone or not a record. */
export async function readRecordSummary(fs: RecordFs, path: string): Promise<LearningRecordSummary | null> {
  const normalized = normalizeVaultPath(path);
  if (!normalized || !/\.md$/i.test(normalized) || !(await fs.exists(normalized))) return null;
  const stat = await fs.stat(normalized);
  if (stat && stat.size > MAX_RECORD_FILE_BYTES) return null;
  const text = await fs.read(normalized);
  const summary = parseRecordSummary(normalized, text, stat?.size ?? text.length);
  return summary ? { ...summary, duplicatePaths: [] } : null;
}

/** Fresh read of the selected records for preview and again right before dispatch. */
export async function readRecordBodies(fs: RecordFs, paths: string[]): Promise<LearningRecordBody[]> {
  const bodies: LearningRecordBody[] = [];
  for (const path of paths) {
    const normalized = normalizeVaultPath(path);
    if (!normalized) throw new Error(`잘못된 기록 경로: ${path}`);
    const text = await fs.read(normalized);
    const summary = parseRecordSummary(normalized, text, text.length);
    if (!summary) throw new Error(`학습 기록 형식이 아닙니다: ${normalized}`);
    bodies.push({ ...toRecordBody(normalized, summary.recordId, text), canContinue: canContinueRecord(summary) });
  }
  return bodies;
}

/** Candidate ordering only: records sharing a source with the current selection come first. */
export function sortByRelevance(records: LearningRecordSummary[], currentSources: string[]): LearningRecordSummary[] {
  const wanted = new Set(currentSources);
  const score = (record: LearningRecordSummary) => record.sourcePaths.filter((path) => wanted.has(path)).length;
  return [...records].sort((a, b) => score(b) - score(a));
}
