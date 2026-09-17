/**
 * Two findings from the peer review of the security work.
 *
 * 1. A failing CLI's stderr is yielded straight into the chat, and the chat is
 *    written to `.copilot/sessions/*.jsonl` inside the vault. Any CLI that
 *    echoes an inherited environment variable in a stack trace would put the
 *    credential back into the synced folder we just took it out of.
 * 2. Model discovery hands the raw CLI path to the process launcher (spawn,
 *    formerly execFile). On Windows a `.cmd` cannot be launched that way at
 *    all — this predates the security work, but the resolver built for it is
 *    the fix.
 */
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/** A CLI path the resolver accepts on the running platform.
 *  On Windows a POSIX path resolves to nothing — correctly — so these tests
 *  would exercise the refusal branch instead of the one they are about. */
const FAKE_CLI = process.platform === 'win32'
  ? 'C:\\Users\\s\\AppData\\Roaming\\npm\\claude.exe'
  : '/usr/local/bin/claude';
const FAKE_CODEX_CLI = process.platform === 'win32'
  ? 'C:\\Users\\s\\AppData\\Roaming\\npm\\codex.exe'
  : '/usr/local/bin/codex';

const TOKEN = 'github_pat_11ABCDEFG_supersecretvalue';
const API_KEY = 'sk-proj-averysecretapikeyvalue';

function childEmitting(stderr: string, exitCode: number): childProcess.ChildProcess {
  const child = new EventEmitter() as unknown as childProcess.ChildProcess;
  const out = new EventEmitter();
  const err = new EventEmitter();
  Object.assign(child, { stdout: out, stderr: err, stdin: { end: jest.fn() }, kill: jest.fn() });
  setImmediate(() => {
    err.emit('data', Buffer.from(stderr));
    (child as unknown as EventEmitter).emit('close', exitCode, null);
  });
  return child;
}

function makeService(
  overrides: Record<string, unknown> = {},
  activeEnvironment = `OPENAI_API_KEY=${API_KEY}\nLANG=ko_KR.UTF-8`
): CopilotBridgeService {
  const fakePlugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      selectedProvider: 'claude',
      providerCliPaths: { claude: FAKE_CLI },
      blanketWriteAcknowledged: ['claude'],
      githubToken: TOKEN,
      ...overrides,
    },
    app: { vault: { adapter: { basePath: '/vault' } } },
    getActiveEnvironmentVariables: () => activeEnvironment,
  } as unknown as ObsidianCopilotPlugin;
  return new CopilotBridgeService(fakePlugin);
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe('credentials never travel back out through an error message', () => {
  beforeEach(() => {
    jest.spyOn(fs, 'statSync').mockImplementation((() => ({ isFile: () => true }) as fs.Stats) as unknown as typeof fs.statSync);
  });
  afterEach(() => jest.restoreAllMocks());

  it('redacts a token a CLI echoed in its stderr', async () => {
    jest.spyOn(childProcess, 'spawn').mockImplementation(() =>
      childEmitting(`Error: auth failed for GH_TOKEN=${TOKEN}\n`, 1)
    );

    const chunks = await drain(makeService().query('hello'));
    const error = chunks.find((c) => c.type === 'error') as { content: string };

    expect(error.content).not.toContain(TOKEN);
    // The rest of the message survives, or the student learns nothing.
    expect(error.content).toContain('auth failed');
  });

  it('redacts a custom environment variable value too', async () => {
    jest.spyOn(childProcess, 'spawn').mockImplementation(() =>
      childEmitting(`Traceback: key ${API_KEY} rejected\n`, 1)
    );

    const chunks = await drain(makeService().query('hello'));
    const error = chunks.find((c) => c.type === 'error') as { content: string };

    expect(error.content).not.toContain(API_KEY);
  });

  it('leaves short, non-secret values alone', async () => {
    // `LANG=ko_KR.UTF-8` is in the same settings field as the API key. Redacting
    // every configured value blindly would scrub ordinary words out of errors.
    jest.spyOn(childProcess, 'spawn').mockImplementation(() =>
      childEmitting('locale ko_KR.UTF-8 is not supported\n', 1)
    );

    const chunks = await drain(makeService().query('hello'));
    const error = chunks.find((c) => c.type === 'error') as { content: string };

    expect(error.content).toContain('ko_KR.UTF-8');
  });
});

describe('model discovery resolves the CLI the same way dispatch does', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('never hands a Windows .cmd straight to spawn', async () => {
    // CreateProcessW cannot launch a batch shim, and there is no shell here to
    // do it — so an unresolved .cmd is an immediate EINVAL, not a slow failure.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const binDir = 'C:\\Users\\s\\AppData\\Roaming\\npm';
    const pkgRoot = `${binDir}\\node_modules\\@openai\\codex`;
    const files: Record<string, string> = {
      [`${binDir}\\codex.cmd`]: 'a shim body we cannot read',
      [`${pkgRoot}\\package.json`]: JSON.stringify({ bin: { codex: 'cli.js' } }),
      [`${pkgRoot}\\cli.js`]: '',
    };
    const has = (p: string) => Object.prototype.hasOwnProperty.call(files, String(p));
    jest.spyOn(fs, 'existsSync').mockImplementation(((p: string) => has(p)) as unknown as typeof fs.existsSync);
    jest.spyOn(fs, 'statSync').mockImplementation(((p: string) => {
      if (!has(p)) throw new Error('ENOENT');
      return { isFile: () => true } as fs.Stats;
    }) as unknown as typeof fs.statSync);
    jest.spyOn(fs, 'readFileSync').mockImplementation(((p: string) => {
      if (!has(p)) throw new Error('ENOENT');
      return files[String(p)];
    }) as unknown as typeof fs.readFileSync);

    // listNativeProviderModels spawns rather than execFiles (see
    // nativeProviderExecFileTeardown.test.ts for why: execFile silently drops
    // `detached`, so a backgrounded helper would survive the call).
    const spawnSpy = jest.spyOn(childProcess, 'spawn').mockImplementation(((
      _cmd: string,
      _args: string[],
      _opts: unknown
    ) => {
      const child = new EventEmitter() as unknown as childProcess.ChildProcess;
      const out = new EventEmitter();
      const err = new EventEmitter();
      Object.assign(child, { stdout: out, stderr: err, kill: jest.fn() });
      setImmediate(() => (child as unknown as EventEmitter).emit('close', 0, null));
      return child;
    }) as unknown as typeof childProcess.spawn);

    const service = makeService({
      selectedProvider: 'codex',
      providerCliPaths: { codex: `${binDir}\\codex.cmd` },
    });
    await service.listNativeProviderModels('codex');

    expect(spawnSpy).toHaveBeenCalled();
    const command = spawnSpy.mock.calls[0][0] as string;
    const args = spawnSpy.mock.calls[0][1] as string[];
    const options = spawnSpy.mock.calls[0][2] as childProcess.SpawnOptions;
    expect(command).not.toMatch(/\.cmd$/i);
    expect(args[0]).toBe(`${pkgRoot}\\cli.js`);
    // The discovery arguments still follow the resolved entry point.
    expect(args.slice(-2)).toEqual(['debug', 'models']);
    // Codex 0.154 reads from its inherited stdin before printing models. Model
    // discovery has no input to supply, so it must close that pipe explicitly.
    expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('uses the configured environment and enhanced PATH for model discovery', async () => {
    jest.spyOn(fs, 'statSync').mockImplementation((() => ({ isFile: () => true }) as fs.Stats) as unknown as typeof fs.statSync);
    const spawnSpy = jest.spyOn(childProcess, 'spawn').mockImplementation((() => {
      const child = new EventEmitter() as unknown as childProcess.ChildProcess;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(child, { stdout, stderr, kill: jest.fn() });
      setImmediate(() => (child as unknown as EventEmitter).emit('close', 0, null));
      return child;
    }) as unknown as typeof childProcess.spawn);

    const customBin = process.platform === 'win32' ? 'C:\\student\\node' : '/student/node';
    await makeService(
      {
        selectedProvider: 'codex',
        providerCliPaths: { codex: FAKE_CODEX_CLI },
      },
      `OPENAI_API_KEY=${API_KEY}\nLANG=ko_KR.UTF-8\nPATH=${customBin}`
    ).listNativeProviderModels('codex');

    const options = spawnSpy.mock.calls[0][2] as childProcess.SpawnOptions;
    expect(options.env?.OPENAI_API_KEY).toBe(API_KEY);
    expect(options.env?.LANG).toBe('ko_KR.UTF-8');
    expect(options.env?.PATH?.split(process.platform === 'win32' ? ';' : ':')[0]).toBe(customBin);
  });

  it('rejects and reaps a model listing that never closes', async () => {
    jest.useFakeTimers();
    jest.spyOn(fs, 'statSync').mockImplementation((() => ({ isFile: () => true }) as fs.Stats) as unknown as typeof fs.statSync);
    const child = new EventEmitter() as unknown as childProcess.ChildProcess;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const kill = jest.fn();
    Object.assign(child, { stdout, stderr, pid: 999_999, kill });
    jest.spyOn(childProcess, 'spawn').mockReturnValue(child);

    const promise = makeService({
      selectedProvider: 'codex',
      providerCliPaths: { codex: FAKE_CODEX_CLI },
    }).listNativeProviderModels('codex');
    const result = promise.then(
      () => new Error('model listing unexpectedly resolved'),
      (error: unknown) => error,
    );

    await jest.advanceTimersByTimeAsync(15_000);

    expect(await result).toMatchObject({ message: 'codex models timed out' });
    const taskkillCalls = jest.mocked(childProcess.spawn).mock.calls.filter(
      ([command]) => String(command).toLowerCase().includes('taskkill'),
    );
    expect(taskkillCalls).toEqual(process.platform === 'win32'
      ? [['taskkill', ['/PID', '999999', '/T', '/F'], { stdio: 'ignore', windowsHide: true }]]
      : []);
    expect(kill.mock.calls).toEqual(process.platform === 'win32' ? [] : [['SIGKILL']]);
  });
});
