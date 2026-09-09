/**
 * The only way the log ever leaves the student's machine.
 *
 * Two faults, both ending with a teacher receiving less than they asked for: it
 * copied 50 of the 300 entries the file keeps, so a student in a crash loop sent
 * the crash loop and not the install failure underneath it; and a refused
 * clipboard write left them holding a button that looked like it had worked.
 */
const noticeMessages: string[] = [];
jest.mock('obsidian', () => ({
  ...jest.requireActual('obsidian'),
  Notice: class {
    constructor(message: string) {
      noticeMessages.push(message);
    }
  },
}));

import { appendErrorLog, ERROR_LOG_PATH, type ErrorLogEntry } from '@/core/storage/ErrorLog';
import type { FailureReportHost } from '@/core/storage/FailureReport';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { copyRecentErrors } from '@/features/settings/errorLogCopy';

function fake() {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  } as unknown as VaultFileAdapter;
  const host: FailureReportHost = {
    storage: { getAdapter: () => adapter },
    manifest: { version: '0.1.16' },
    agentService: { redactForLog: (t: string) => t },
  };
  return { adapter, host, files };
}

function entry(i: number): ErrorLogEntry {
  return {
    at: '2026-09-09T00:00:00.000Z',
    provider: 'copilot',
    stage: 'exit',
    message: `failure ${i}`,
    platform: 'win32 x64',
    pluginVersion: '0.1.16',
  };
}

beforeEach(() => {
  noticeMessages.length = 0;
});

describe('copyRecentErrors', () => {
  it('copies the whole file, not the reader\'s default page', async () => {
    const { adapter, host } = fake();
    for (let i = 0; i < 300; i++) {
      // eslint-disable-next-line no-await-in-loop -- appends are ordered by design
      await appendErrorLog(adapter, ERROR_LOG_PATH, entry(i));
    }
    let copied = '';
    await copyRecentErrors(adapter, host, { writeText: async (t) => { copied = t; } });

    // The oldest entry is the one a truncated copy would have dropped, and it is
    // usually the install failure everything after it is a consequence of.
    expect(copied).toContain('failure 0');
    expect(copied).toContain('failure 299');
    expect(noticeMessages).toEqual(['최근 오류 300건을 복사했습니다.']);
  });

  it('tells the student when the clipboard refuses, and where the file is', async () => {
    const { adapter, host, files } = fake();
    await appendErrorLog(adapter, ERROR_LOG_PATH, entry(1));

    await copyRecentErrors(adapter, host, {
      writeText: async () => { throw new Error('NotAllowedError'); },
    });

    expect(noticeMessages).toHaveLength(1);
    expect(noticeMessages[0]).toContain('복사하지 못했습니다');
    expect(noticeMessages[0]).toContain(ERROR_LOG_PATH);
    // And it does not claim to have copied anything.
    expect(noticeMessages[0]).not.toContain('복사했습니다.');
    // The refusal is itself a failure the student was shown, so it is recorded.
    const lines = (files.get(ERROR_LOG_PATH) ?? '').split('\n').filter((l) => l.trim());
    await new Promise((resolve) => setImmediate(resolve));
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it('treats a missing clipboard the same as a refused one', async () => {
    const { adapter, host } = fake();

    await copyRecentErrors(adapter, host, undefined);

    expect(noticeMessages[0]).toContain('복사하지 못했습니다');
  });

  it('says so plainly when there is nothing to hand over', async () => {
    const { adapter, host } = fake();

    await copyRecentErrors(adapter, host, { writeText: async () => undefined });

    expect(noticeMessages).toEqual(['기록된 오류가 없습니다.']);
  });
});
