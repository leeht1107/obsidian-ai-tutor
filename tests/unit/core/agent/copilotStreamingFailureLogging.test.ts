/**
 * The three copilot streaming failures that still left nothing behind.
 *
 * These do not go through `reportBlockingFailure`: their failure reaches the
 * student as a yielded `error` chunk inside an async generator, not as a Notice,
 * and reshaping them to fit a Notice-shaped seam would change control flow in
 * the one place that must not change. They log next to the chunk they push, and
 * these tests are what stands in for the seam's guarantee.
 *
 * What was missing, and why each one matters on the machine this release is for:
 *
 * - `child.on('error')`. The asynchronous half of a failed launch — an ENOENT on
 *   a shim that passed the resolver, a permissions failure. The native provider
 *   folds the same event into an `exitCode = 1` entry; only copilot, the
 *   default, dropped it.
 * - A non-zero exit with nothing on stderr. The log was written only when stderr
 *   had content, so a CLI that was killed, ran out of memory, or crashed
 *   silently produced a red bubble and no record.
 * - Exit 0 with no answer. The native providers call this `empty-answer` and log
 *   it; copilot returned an empty bubble and counted the run as fine.
 */
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('@/utils/copilotCli', () => ({
  findCopilotCLIPath: jest.fn(() => '/usr/local/bin/copilot'),
  resolveProviderEntry: jest.fn(() => ['/usr/local/bin/copilot', []]),
}));

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import { ERROR_LOG_PATH, type ErrorLogEntry } from '@/core/storage/ErrorLog';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';
import { resolveProviderEntry } from '@/utils/copilotCli';

const HOME_VAULT = path.join(os.homedir(), 'Obsidian', 'vault');

function makeService() {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, selectedProvider: 'copilot', copilotCliPath: '/usr/local/bin/copilot' },
    manifest: { version: '0.1.16' },
    app: { vault: { adapter: { basePath: HOME_VAULT } } },
    storage: { getAdapter: () => adapter },
    getActiveEnvironmentVariables: () => '',
  } as unknown as ObsidianCopilotPlugin;
  return { service: new CopilotBridgeService(plugin), files };
}

/**
 * A child process that does only what this generator listens to.
 *
 * `spawn` has to return something before the generator attaches its handlers, so
 * the script the test wants to act out is queued on the next tick.
 */
function fakeChild(act: (child: FakeChild) => void) {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: () => undefined, write: () => true };
  child.pid = 4242;
  child.kill = () => true;
  setImmediate(() => act(child));
  return child;
}

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: () => void; write: () => boolean };
  pid: number;
  kill: () => boolean;
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

async function entries(files: Map<string, string>): Promise<ErrorLogEntry[]> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return (files.get(ERROR_LOG_PATH) ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ErrorLogEntry);
}

beforeEach(() => {
  jest.spyOn(fs, 'statSync').mockImplementation((() => ({ isFile: () => true }) as fs.Stats) as unknown as typeof fs.statSync);
});
afterEach(() => jest.restoreAllMocks());

describe('the copilot stream records the failures it shows the student', () => {
  it('logs an asynchronous launch failure, the same event the native path already logs', async () => {
    const { service, files } = makeService();
    jest.spyOn(childProcess, 'spawn').mockImplementation((() => fakeChild((child) => {
      child.emit('error', new Error('spawn ENOENT'));
    })) as unknown as typeof childProcess.spawn);

    const chunks = await drain(service.query('안녕'));

    expect(chunks.some((c) => c.type === 'error' && c.content.includes('ENOENT'))).toBe(true);
    const launch = (await entries(files)).find((e) => e.stage === 'launch');
    expect(launch).toBeDefined();
    expect(launch?.provider).toBe('copilot');
    expect(launch?.message).toContain('ENOENT');
  });

  it('logs a non-zero exit even when the CLI died without writing to stderr', async () => {
    // The old condition also required stderr, so a silent death — killed, OOM,
    // a crash with no message — was shown to the student and recorded nowhere.
    const { service, files } = makeService();
    jest.spyOn(childProcess, 'spawn').mockImplementation((() => fakeChild((child) => {
      child.emit('close', 137, null);
    })) as unknown as typeof childProcess.spawn);

    const chunks = await drain(service.query('안녕'));

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    const exit = (await entries(files)).find((e) => e.stage === 'exit');
    expect(exit).toBeDefined();
    expect(exit?.exitCode).toBe(137);
  });

  it('still prefers the stderr text when there is some', async () => {
    const { service, files } = makeService();
    jest.spyOn(childProcess, 'spawn').mockImplementation((() => fakeChild((child) => {
      child.stderr.emit('data', Buffer.from('No authentication information found'));
      child.emit('close', 1, null);
    })) as unknown as typeof childProcess.spawn);

    await drain(service.query('안녕'));

    const exit = (await entries(files)).find((e) => e.stage === 'exit');
    expect(exit?.message).toContain('authentication required');
  });

  it('logs a clean exit that answered nothing, as the native providers do', async () => {
    const { service, files } = makeService();
    jest.spyOn(childProcess, 'spawn').mockImplementation((() => fakeChild((child) => {
      child.emit('close', 0, null);
    })) as unknown as typeof childProcess.spawn);

    const chunks = await drain(service.query('안녕'));

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
    const empty = (await entries(files)).find((e) => e.stage === 'empty-answer');
    expect(empty).toBeDefined();
    expect(empty?.exitCode).toBe(0);
  });

  it('says nothing at all about a run that answered normally', async () => {
    // The contract the whole file rests on: an empty log means the student was
    // never shown a failure.
    const { service, files } = makeService();
    jest.spyOn(childProcess, 'spawn').mockImplementation((() => fakeChild((child) => {
      child.stdout.emit('data', Buffer.from('{"type":"assistant.message_delta","data":{"deltaContent":"안녕하세요"}}\n'));
      child.emit('close', 0, null);
    })) as unknown as typeof childProcess.spawn);

    const chunks = await drain(service.query('안녕'));

    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(await entries(files)).toEqual([]);
  });

  it('does not log a request the student stopped themselves', async () => {
    // A cancel arrives as a non-zero exit and is not a failure. Logging it would
    // be the one thing that destroys the meaning of an empty log.
    const { service, files } = makeService();
    jest.spyOn(childProcess, 'spawn').mockImplementation((() => fakeChild((child) => {
      service.cancel();
      child.emit('close', null, 'SIGTERM');
    })) as unknown as typeof childProcess.spawn);

    await drain(service.query('안녕'));

    expect(await entries(files)).toEqual([]);
  });

  it('keeps the account name out of the composite command a Windows shim resolves to', async () => {
    // The leak 0.1.15 shipped. On Windows an npm `.cmd` shim resolves to a
    // synthetic pair — `node.exe <path under the home directory>` — and the
    // masker only looked at character zero, so the student's account name was
    // written to the file verbatim. Every test that touched this path ran on the
    // POSIX branch, where the resolved value happens to start at the home
    // directory, which is why nothing caught it.
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const home = os.homedir();
      const { service, files } = makeService();
      (resolveProviderEntry as jest.Mock).mockReturnValue([
        'C:\\Program Files\\nodejs\\node.exe',
        [`${home}\\AppData\\Roaming\\npm\\node_modules\\@github\\copilot\\index.js`],
      ]);
      jest.spyOn(childProcess, 'spawn').mockImplementation((() => fakeChild((child) => {
        child.emit('error', new Error('spawn ENOENT'));
      })) as unknown as typeof childProcess.spawn);

      await drain(service.query('안녕'));

      const launch = (await entries(files)).find((e) => e.stage === 'launch');
      expect(launch?.resolved).toBeDefined();
      expect(launch?.resolved).toContain('node.exe');
      expect(launch?.resolved).toContain('~');
      expect(files.get(ERROR_LOG_PATH)).not.toContain(home);
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
      (resolveProviderEntry as jest.Mock).mockReturnValue(['/usr/local/bin/copilot', []]);
    }
  });
});
