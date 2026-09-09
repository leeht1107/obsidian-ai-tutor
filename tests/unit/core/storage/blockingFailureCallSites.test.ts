/**
 * One entry per call site, and no throw when the log is unreachable.
 *
 * `failureReport.test.ts` covers the seam itself. This covers the wiring: each
 * place that now reports through it writes exactly one entry, and each keeps
 * doing what it did before when the adapter is broken — the caller is already
 * handling a failure, and a logger that turns it into a second one is worse than
 * no logger.
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

import type { App } from 'obsidian';

import { ERROR_LOG_PATH, type ErrorLogEntry } from '@/core/storage/ErrorLog';
import type { FailureReportHost } from '@/core/storage/FailureReport';
import { writeSecretsOrNotify, writeTrustOrNotify } from '@/core/storage/SecretStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { installObsidianSkills, installSkillFromUrl, removeSkill, uninstallObsidianSkills } from '@/features/skills/ObsidianSkillsInstaller';

function makeHost(broken = false) {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  } as unknown as VaultFileAdapter;
  const host: FailureReportHost = {
    storage: {
      getAdapter: broken
        ? () => { throw new Error('vault not ready'); }
        : () => adapter,
    },
    manifest: { version: '0.1.16' },
    agentService: { redactForLog: (t: string) => t },
  };
  return { host, files };
}

/** Device-local storage that refuses every write. */
function refusingApp(): App {
  return {
    loadLocalStorage: () => null,
    saveLocalStorage: () => { throw new Error('quota exceeded'); },
  } as unknown as App;
}

/** A vault Obsidian cannot give a filesystem path for. */
const pathlessApp = { vault: { adapter: {} } } as unknown as App;

async function entries(files: Map<string, string>): Promise<ErrorLogEntry[]> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return (files.get(ERROR_LOG_PATH) ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ErrorLogEntry);
}

beforeEach(() => {
  noticeMessages.length = 0;
});

describe('a credential that could not be stored', () => {
  it('is shown and recorded once', async () => {
    const { host, files } = makeHost();

    expect(writeSecretsOrNotify(refusingApp(), { githubToken: 'x', environmentVariables: '' }, host)).toBe(false);

    expect(noticeMessages).toHaveLength(1);
    expect(await entries(files)).toHaveLength(1);
  });

  it('still returns false, and still tells the student, when the log is unreachable', async () => {
    const { host } = makeHost(true);

    expect(writeSecretsOrNotify(refusingApp(), { githubToken: 'x', environmentVariables: '' }, host)).toBe(false);

    expect(noticeMessages).toHaveLength(1);
  });
});

describe('trust settings that could not be stored', () => {
  it('are shown and recorded once', async () => {
    const { host, files } = makeHost();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(writeTrustOrNotify(refusingApp(), {} as any, host)).toBe(false);

    expect(noticeMessages).toHaveLength(1);
    expect(await entries(files)).toHaveLength(1);
  });
});

describe('the skills installer', () => {
  it('records a skills folder it could not resolve, on both the remove paths', async () => {
    const { host, files } = makeHost();

    expect(await removeSkill(pathlessApp, 'obsidian-markdown', 'claude', host)).toBe(false);
    expect(await uninstallObsidianSkills(pathlessApp, 'claude', host)).toBe(false);

    const logged = await entries(files);
    expect(logged).toHaveLength(2);
    expect(logged.every((e) => e.stage === 'install' && e.provider === 'claude')).toBe(true);
  });

  it('records a vault path it could not resolve while installing from a URL', async () => {
    const { host, files } = makeHost();

    expect(await installSkillFromUrl(pathlessApp, 'https://github.com/x/y', 'claude', host)).toBe(false);

    expect(await entries(files)).toHaveLength(1);
  });

  it('stays silent about the automatic install that quietly gives up and retries later', async () => {
    // `installObsidianSkills` returns false without showing anything when the
    // vault path is not ready yet — it runs again on the next launch. Nothing was
    // put in front of the student, so nothing belongs in the log.
    const { host, files } = makeHost();

    expect(await installObsidianSkills(pathlessApp, 'claude', host)).toBe(false);

    expect(noticeMessages).toEqual([]);
    expect(await entries(files)).toEqual([]);
  });

  it('does not turn a broken log into a second failure for the student', async () => {
    const { host } = makeHost(true);

    await expect(removeSkill(pathlessApp, 'obsidian-markdown', 'claude', host)).resolves.toBe(false);
    expect(noticeMessages).toHaveLength(1);
  });
});
