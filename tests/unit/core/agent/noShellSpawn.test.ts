/**
 * No request may ever be dispatched through a shell.
 *
 * The prompt handed to a provider CLI is built from the student's question, the
 * open note and the conversation so far. With `shell: true` Node gives cmd.exe a
 * single command string and escapes none of it, so `& calc` sitting in a note
 * becomes a command. Windows was the only platform that ever set it, and only as
 * a fallback — which made it invisible to every test run on macOS.
 *
 * These force `process.platform` to win32 precisely because that is the branch no
 * one here can run for real.
 */
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

const WIN_BIN = 'C:\\Users\\s\\AppData\\Roaming\\npm';

/** A child process that answers once and exits cleanly, without touching the OS. */
function fakeChild(): childProcess.ChildProcess {
  const child = new EventEmitter() as unknown as childProcess.ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  Object.assign(child, {
    stdout,
    stderr,
    stdin: { end: jest.fn(), write: jest.fn() },
    kill: jest.fn(),
  });
  setImmediate(() => {
    stdout.emit('data', Buffer.from('{"delta":{"text":"ok"}}\n'));
    (child as unknown as EventEmitter).emit('close', 0, null);
  });
  return child;
}

function makeService(cliPath: string): CopilotBridgeService {
  const fakePlugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      selectedProvider: 'claude',
      providerCliPaths: { claude: cliPath },
      blanketWriteAcknowledged: ['claude'],
    },
    app: { vault: { adapter: { basePath: 'C:\\vault' } } },
    getActiveEnvironmentVariables: () => '',
  } as unknown as ObsidianCopilotPlugin;
  return new CopilotBridgeService(fakePlugin);
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe('native dispatch never asks for a shell', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform);
    jest.restoreAllMocks();
  });

  it('spawns without a shell on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    jest.spyOn(fs, 'statSync').mockImplementation((() => ({ isFile: () => true }) as fs.Stats) as unknown as typeof fs.statSync);
    const spawnSpy = jest.spyOn(childProcess, 'spawn').mockImplementation(fakeChild);

    await drain(makeService(`${WIN_BIN}\\claude.exe`).query('hello'));

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const options = spawnSpy.mock.calls[0][2] as childProcess.SpawnOptions;
    expect(options.shell).toBeFalsy();
  });

  it('keeps shell metacharacters inside one argv element instead of a command string', async () => {
    // Every one of these is a cmd.exe operator. Passed as a single argv element
    // they are inert text; concatenated into a shell string they are commands.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    jest.spyOn(fs, 'statSync').mockImplementation((() => ({ isFile: () => true }) as fs.Stats) as unknown as typeof fs.statSync);
    const spawnSpy = jest.spyOn(childProcess, 'spawn').mockImplementation(fakeChild);

    const hostile = '요약해줘 & calc | whoami > out.txt ^ %PATH% "quoted"';
    await drain(makeService(`${WIN_BIN}\\claude.exe`).query(hostile));

    const args = spawnSpy.mock.calls[0][1] as string[];
    const carrying = args.filter((a) => a.includes('calc'));
    expect(carrying).toHaveLength(1);
    expect(carrying[0]).toContain(hostile);
  });

  it('refuses to dispatch at all when no real executable can be resolved', async () => {
    // The old code answered this case with `shell: true`. Refusing is the fix;
    // the student sees Korean guidance rather than a mangled or hostile run.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    jest.spyOn(fs, 'statSync').mockImplementation(((p: string) => {
      if (String(p).endsWith('claude.cmd')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    }) as unknown as typeof fs.statSync);
    jest.spyOn(fs, 'existsSync').mockImplementation(((p: string) => String(p).endsWith('claude.cmd')) as unknown as typeof fs.existsSync);
    jest.spyOn(fs, 'readFileSync').mockImplementation(((() => 'a shim body we cannot read')) as unknown as typeof fs.readFileSync);
    const spawnSpy = jest.spyOn(childProcess, 'spawn').mockImplementation(fakeChild);

    const chunks = await drain(makeService(`${WIN_BIN}\\claude.cmd`).query('hello'));

    expect(spawnSpy).not.toHaveBeenCalled();
    const error = chunks.find((c) => c.type === 'error');
    expect(error).toBeDefined();
    // Student-facing, so Korean, and it must point at the fix rather than the cause.
    expect((error as { content: string }).content).toMatch(/[가-힣]/);
    expect((error as { content: string }).content).toContain('자동 설정');
  });
});

describe('the refusal message tells the truth about each provider', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform);
    jest.restoreAllMocks();
  });

  function unresolvableFs(name: string): void {
    jest.spyOn(fs, 'statSync').mockImplementation(((p: string) => {
      if (String(p).endsWith(`${name}.cmd`)) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    }) as unknown as typeof fs.statSync);
    jest.spyOn(fs, 'existsSync').mockImplementation(((p: string) => String(p).endsWith(`${name}.cmd`)) as unknown as typeof fs.existsSync);
    jest.spyOn(fs, 'readFileSync').mockImplementation((() => 'unparseable') as unknown as typeof fs.readFileSync);
  }

  function serviceFor(provider: string, cliPath: string): CopilotBridgeService {
    const fakePlugin = {
      settings: {
        ...DEFAULT_SETTINGS,
        selectedProvider: provider,
        providerCliPaths: { [provider]: cliPath },
        blanketWriteAcknowledged: [provider],
      },
      app: { vault: { adapter: { basePath: 'C:\\vault' } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin;
    return new CopilotBridgeService(fakePlugin);
  }

  it('does not promise auto-install for a provider that has none', async () => {
    // agy is manual-setup: the wizard opens on its manual page, with no install
    // button. Pointing a student at one is a dead end dressed as a fix.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    unresolvableFs('agy');
    jest.spyOn(childProcess, 'spawn').mockImplementation(fakeChild);

    const chunks = await drain(serviceFor('agy', `${WIN_BIN}\\agy.cmd`).query('hello'));
    const error = chunks.find((c) => c.type === 'error') as { content: string };

    expect(error.content).not.toContain('자동 설정 창에서 다시 설치');
    expect(error.content).toContain('자동 설치를 지원하지 않습니다');
  });
});
