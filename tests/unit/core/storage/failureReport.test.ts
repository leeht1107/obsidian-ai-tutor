/**
 * One seam, so a student-visible failure cannot be added without a log line.
 *
 * Release 0.1.15 wired seven failure points by hand; the audit that followed
 * found roughly thirteen more that were still silent — including the one this
 * whole feature exists for, a Windows machine with no Node.js and no package
 * manager, where the wizard shows "install it yourself" and records nothing.
 *
 * Enumerating them again would fix today's list and nothing else. So every
 * failure whose delivery is a Notice now goes through `reportBlockingFailure`,
 * which shows the sentence and writes the entry in the same call. The streaming
 * chat paths keep their own `recordError` calls: their failure is a yielded
 * chunk inside an async generator, not a Notice, and routing them through a
 * Notice-shaped seam would change control flow in the one place that must not
 * change.
 *
 * The contract this file exists to hold:
 * - never throws, whatever the adapter does;
 * - the student sees the sentence even when logging fails;
 * - a cancellation is never reported here, so an empty log keeps meaning
 *   "the student was never shown a failure".
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

import * as os from 'os';

import { ERROR_LOG_PATH } from '@/core/storage/ErrorLog';
import { type FailureReportHost, reportBlockingFailure } from '@/core/storage/FailureReport';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function fakeHost(overrides: Partial<FailureReportHost> = {}) {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  } as unknown as VaultFileAdapter;
  const host: FailureReportHost = {
    storage: { getAdapter: () => adapter },
    manifest: { version: '0.1.16' },
    agentService: { redactForLog: (text: string) => text.replace(/hunter2/g, '[redacted]') },
    ...overrides,
  };
  return { host, files };
}

/** The append is started, not awaited, exactly as every caller does. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

function written(files: Map<string, string>) {
  return (files.get(ERROR_LOG_PATH) ?? '')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

beforeEach(() => {
  noticeMessages.length = 0;
});

describe('reportBlockingFailure', () => {
  it('shows the student the sentence and records the same failure', async () => {
    const { host, files } = fakeHost();

    reportBlockingFailure(host, {
      notice: 'Node.js를 설치하지 못했습니다.',
      provider: 'node',
      stage: 'install',
      detail: 'winget exited with 1',
    });
    await settle();

    expect(noticeMessages).toEqual(['Node.js를 설치하지 못했습니다.']);
    expect(written(files)).toEqual([
      expect.objectContaining({
        provider: 'node',
        stage: 'install',
        message: 'Node.js를 설치하지 못했습니다.\nwinget exited with 1',
        pluginVersion: '0.1.16',
      }),
    ]);
  });

  it('still shows the sentence when the log cannot be written', async () => {
    // The order matters, not just the outcome. The student's own problem is the
    // one being reported; the log is for whoever reads it afterwards.
    const { host } = fakeHost({
      storage: {
        getAdapter: () => { throw new Error('vault not ready'); },
      },
    });

    expect(() => reportBlockingFailure(host, {
      notice: '설정을 저장하지 못했습니다.',
      stage: 'internal',
    })).not.toThrow();
    await settle();

    expect(noticeMessages).toEqual(['설정을 저장하지 못했습니다.']);
  });

  it('does not throw when the plugin has no storage at all yet', async () => {
    const { host } = fakeHost({ storage: undefined, manifest: undefined });

    expect(() => reportBlockingFailure(host, { notice: '시작하지 못했습니다.', stage: 'internal' })).not.toThrow();
    await settle();

    expect(noticeMessages).toEqual(['시작하지 못했습니다.']);
  });

  it('redacts the configured credentials out of the detail before writing it', async () => {
    const { host, files } = fakeHost();

    reportBlockingFailure(host, {
      notice: '설치에 실패했습니다.',
      stage: 'install',
      detail: 'npm error using password hunter2',
    });
    await settle();

    expect(written(files)[0].message).toContain('[redacted]');
    expect(files.get(ERROR_LOG_PATH)).not.toContain('hunter2');
  });

  it('drops the detail rather than write text nothing has redacted', async () => {
    // The bridge owns the pattern that removes the student's configured token.
    // Before it exists there is no way to know whether third-party output
    // carries one — but the notice is this plugin's own literal sentence, so it
    // is still safe, and losing the entry entirely would leave a blocked student
    // with an empty log.
    const { host, files } = fakeHost({ agentService: undefined });

    reportBlockingFailure(host, {
      notice: '설치에 실패했습니다.',
      stage: 'install',
      detail: 'npm error using password hunter2',
    });
    await settle();

    const entries = written(files);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('설치에 실패했습니다.');
    expect(files.get(ERROR_LOG_PATH)).not.toContain('hunter2');
  });

  it('masks the home directory out of the paths it is given', async () => {
    const { host, files } = fakeHost();

    reportBlockingFailure(host, {
      notice: '실행 파일을 찾지 못했습니다.',
      stage: 'resolve',
      cliPath: `${os.homedir()}/.npm/bin/claude`,
    });
    await settle();

    expect(written(files)[0].cliPath).toBe('~/.npm/bin/claude');
  });

  it('carries the exit code and provider through to the entry', async () => {
    const { host, files } = fakeHost();

    reportBlockingFailure(host, {
      notice: '모델 목록을 가져오지 못했습니다.',
      provider: 'codex',
      stage: 'exit',
      exitCode: 1,
    });
    await settle();

    expect(written(files)[0]).toMatchObject({ provider: 'codex', stage: 'exit', exitCode: 1 });
  });

  it('defaults the provider to the plugin itself when no CLI was involved', async () => {
    const { host, files } = fakeHost();

    reportBlockingFailure(host, { notice: '설정을 옮기지 못했습니다.', stage: 'internal' });
    await settle();

    expect(written(files)[0].provider).toBe('plugin');
  });

  it('keeps both entries when two failures are reported in the same tick', async () => {
    const { host, files } = fakeHost();

    reportBlockingFailure(host, { notice: '첫 번째', stage: 'internal' });
    reportBlockingFailure(host, { notice: '두 번째', stage: 'internal' });
    await settle();
    await settle();

    expect(written(files).map((e) => e.message)).toEqual(['첫 번째', '두 번째']);
  });
});
