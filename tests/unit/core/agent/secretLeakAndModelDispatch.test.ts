/**
 * Two findings from the peer review of the security work.
 *
 * 1. A failing CLI's stderr is yielded straight into the chat, and the chat is
 *    written to `.copilot/sessions/*.jsonl` inside the vault. Any CLI that
 *    echoes an inherited environment variable in a stack trace would put the
 *    credential back into the synced folder we just took it out of.
 * 2. Model discovery hands the raw CLI path to execFile. On Windows a `.cmd`
 *    cannot be launched that way at all — this predates the security work, but
 *    the resolver built for it is the fix.
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

function makeService(overrides: Record<string, unknown> = {}): CopilotBridgeService {
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
    getActiveEnvironmentVariables: () => `OPENAI_API_KEY=${API_KEY}\nLANG=ko_KR.UTF-8`,
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
    jest.restoreAllMocks();
  });

  it('never hands a Windows .cmd straight to execFile', async () => {
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

    const execFileSpy = jest.spyOn(childProcess, 'execFile').mockImplementation(((
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, out: string) => void
    ) => {
      cb(null, '');
      return new EventEmitter() as unknown as childProcess.ChildProcess;
    }) as unknown as typeof childProcess.execFile);

    const service = makeService({
      selectedProvider: 'codex',
      providerCliPaths: { codex: `${binDir}\\codex.cmd` },
    });
    await service.listNativeProviderModels('codex');

    expect(execFileSpy).toHaveBeenCalled();
    const command = execFileSpy.mock.calls[0][0] as string;
    const args = execFileSpy.mock.calls[0][1] as string[];
    expect(command).not.toMatch(/\.cmd$/i);
    expect(args[0]).toBe(`${pkgRoot}\\cli.js`);
    // The discovery arguments still follow the resolved entry point.
    expect(args.slice(-2)).toEqual(['debug', 'models']);
  });
});
