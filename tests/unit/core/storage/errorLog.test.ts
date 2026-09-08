/**
 * The failures worth logging are the ones nobody here can reproduce: a Windows
 * shim that resolves to nothing, a CLI that exits without answering. The student
 * sees one Korean sentence and the evidence is gone.
 *
 * So the log has to survive being read by a person weeks later, and it has to be
 * safe to hand over — which means no credentials and no real names in paths.
 */
import {
  appendErrorLog,
  ERROR_LOG_PATH,
  type ErrorLogEntry,
  formatErrorsForReport,
  maskHome,
  readRecentErrors,
} from '@/core/storage/ErrorLog';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

const LOG_PATH = ERROR_LOG_PATH;

/** An in-memory vault. */
function fakeAdapter(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  } as unknown as VaultFileAdapter;
  return { adapter, files };
}

function entry(overrides: Partial<ErrorLogEntry> = {}): ErrorLogEntry {
  return {
    at: '2026-09-07T04:00:00.000Z',
    provider: 'claude',
    stage: 'exit',
    message: 'CLI exited with code 1',
    platform: 'win32',
    pluginVersion: '0.1.8',
    ...overrides,
  };
}

describe('ErrorLog', () => {
  it('lives in the vault so a student can find it on any platform', () => {
    // It used to sit under `.obsidian/plugins/<id>/logs/`, which is correct but
    // unreachable for the person who has to send it: on Windows that folder is
    // hidden, and asking a student to open it by hand is how the evidence gets
    // lost. `.ai-tutor/` is the folder they already know.
    expect(ERROR_LOG_PATH).toBe('.ai-tutor/logs/errors.jsonl');
  });

  it('writes one JSON object per line', async () => {
    const { adapter, files } = fakeAdapter();
    await appendErrorLog(adapter, LOG_PATH, entry());

    expect(JSON.parse((files.get(LOG_PATH) ?? '').trim())).toMatchObject({ provider: 'claude', stage: 'exit' });
  });

  it('keeps the tail rather than growing without limit', async () => {
    // A student who hits a crash loop must not end up mailing a 40 MB file.
    const { adapter, files } = fakeAdapter();
    for (let i = 0; i < 320; i++) {
      // eslint-disable-next-line no-await-in-loop -- appends are ordered by design
      await appendErrorLog(adapter, LOG_PATH, entry({ message: `failure ${i}` }));
    }

    const lines = (files.get(LOG_PATH) ?? '').split('\n').filter(Boolean);
    expect(lines.length).toBe(300);
    // The newest survives; the oldest is what got dropped.
    expect(lines[lines.length - 1]).toContain('failure 319');
    expect(files.get(LOG_PATH)).not.toContain('failure 0"');
  });

  it('never throws when the vault refuses the write', async () => {
    // A logger that takes a request down is worse than no logger.
    const broken = {
      exists: async () => false,
      read: async () => '',
      write: async () => { throw new Error('EACCES'); },
    } as unknown as VaultFileAdapter;

    await expect(appendErrorLog(broken, LOG_PATH, entry())).resolves.toBeUndefined();
  });

  it('survives a corrupted line when reading back', async () => {
    const { adapter } = fakeAdapter({
      [LOG_PATH]: `${JSON.stringify(entry())}\nnot json at all\n${JSON.stringify(entry({ provider: 'codex' }))}\n`,
    });
    const read = await readRecentErrors(adapter, LOG_PATH);
    expect(read.map((e) => e.provider)).toEqual(['claude', 'codex']);
  });

  it('masks the home directory out of a path', () => {
    // `C:\Users\<real name>\AppData\...` is the whole diagnostic on Windows, so
    // the path is kept and only the name is removed.
    expect(maskHome('C:\\Users\\Jihoon\\AppData\\Roaming\\npm\\claude.cmd', 'C:\\Users\\Jihoon'))
      .toBe('~\\AppData\\Roaming\\npm\\claude.cmd');
    expect(maskHome('/opt/homebrew/bin/claude', '/Users/jihoon')).toBe('/opt/homebrew/bin/claude');
    expect(maskHome(undefined, '/Users/jihoon')).toBeUndefined();
  });

  it('formats entries as something a student can paste into a message', () => {
    const text = formatErrorsForReport([
      entry({ stage: 'resolve', message: '실행 파일을 찾지 못했습니다', cliPath: '~\\AppData\\Roaming\\npm\\claude.cmd' }),
    ]);

    expect(text).toContain('claude / resolve');
    expect(text).toContain('~\\AppData\\Roaming\\npm\\claude.cmd');
    expect(text).toContain('win32');
    expect(text).toContain('0.1.8');
  });

  it('says so plainly when there is nothing to report', () => {
    expect(formatErrorsForReport([])).toBe('기록된 오류가 없습니다.');
  });
});
