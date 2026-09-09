/**
 * The 최근 오류 복사 button, extracted from the settings tab so it can be tested.
 *
 * This is the only way the log ever leaves the student's machine, and it had two
 * faults that both ended with a teacher receiving less than they asked for:
 *
 * - It copied the reader's default page of 50 entries out of the 300 the file
 *   keeps, so a student in a crash loop sent the crash loop and not the install
 *   failure underneath it.
 * - A refused `navigator.clipboard.writeText` — no permission, no focus, no
 *   clipboard at all — left them holding a button that looked like it had
 *   worked, and a message they thought they had already sent.
 */
import { Notice } from 'obsidian';

import {
  ERROR_LOG_PATH,
  formatErrorsForReport,
  MAX_ENTRIES,
  readRecentErrors,
} from '../../core/storage/ErrorLog';
import { type FailureReportHost, reportBlockingFailure } from '../../core/storage/FailureReport';
import type { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';

/** Just enough of the browser clipboard to be replaced in a test. */
export interface ClipboardLike {
  writeText: (text: string) => Promise<void>;
}

export async function copyRecentErrors(
  adapter: VaultFileAdapter,
  host: FailureReportHost,
  clipboard: ClipboardLike | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard
): Promise<void> {
  const entries = await readRecentErrors(adapter, ERROR_LOG_PATH, MAX_ENTRIES);
  try {
    if (!clipboard) throw new Error('no clipboard available');
    await clipboard.writeText(formatErrorsForReport(entries));
  } catch (error) {
    // Through the seam, so the failure of the reporting tool is itself reported
    // — and so the student is told where the file is, which is the one thing
    // that still works when the clipboard does not.
    reportBlockingFailure(host, {
      notice: `기록을 복사하지 못했습니다. 보관함의 ${ERROR_LOG_PATH} 파일을 직접 열어 보내 주세요.`,
      stage: 'internal',
      detail: error instanceof Error ? error.message : String(error),
      durationMs: 10000,
    });
    return;
  }
  new Notice(entries.length > 0
    ? `최근 오류 ${entries.length}건을 복사했습니다.`
    : '기록된 오류가 없습니다.');
}
