import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

import { spawn } from 'child_process';

import { findProviderCliPath } from '@/core/providers/providerRegistry';
import { findNpmPath, startProviderInstall } from '@/core/setup/AutoSetupService';
import { findCopilotCLIPath } from '@/utils/copilotCli';
import { getEnhancedPath } from '@/utils/env';

const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;
const describeUnix = process.platform === 'win32' ? describe.skip : describe;

describeUnix('NVM provider discovery and installation', () => {
  let home: string;
  let nvmBin: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalExistsSync: typeof fs.existsSync;
  let originalStatSync: typeof fs.statSync;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-ai-tutor-nvm-'));
    nvmBin = path.join(home, '.nvm', 'versions', 'node', 'v22.14.0', 'bin');
    fs.mkdirSync(nvmBin, { recursive: true });
    fs.mkdirSync(path.join(home, '.nvm', 'alias'), { recursive: true });
    fs.writeFileSync(path.join(home, '.nvm', 'alias', 'default'), '22\n');
    fs.writeFileSync(path.join(home, '.nvm', 'alias', '22'), 'v22.14.0\n');
    fs.writeFileSync(path.join(nvmBin, 'node'), '');
    fs.writeFileSync(path.join(nvmBin, 'npm'), '');

    originalEnv = { ...process.env };
    process.env.HOME = home;
    process.env.PATH = '/usr/bin:/bin';
    delete process.env.NVM_BIN;
    jest.spyOn(os, 'homedir').mockReturnValue(home);

    originalExistsSync = fs.existsSync;
    originalStatSync = fs.statSync;
    jest.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
      const value = String(candidate);
      return value.startsWith(home) ? originalExistsSync(candidate) : false;
    });
    jest.spyOn(fs, 'statSync').mockImplementation(((candidate: fs.PathLike, options?: unknown) => {
      const value = String(candidate);
      if (value.startsWith(home)) return originalStatSync(candidate, options as never);
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    }) as typeof fs.statSync);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockedSpawn.mockReset();
    Object.keys(process.env).forEach(key => delete process.env[key]);
    Object.assign(process.env, originalEnv);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('adds the default NVM Node bin to the enhanced PATH without NVM_BIN', () => {
    expect(getEnhancedPath().split(path.delimiter)).toContain(nvmBin);
  });

  it('keeps NVM_BIN ahead of the default alias candidate', () => {
    const activeBin = path.join(home, '.nvm', 'versions', 'node', 'v20.18.0', 'bin');
    process.env.NVM_BIN = activeBin;

    const nvmCandidates = getEnhancedPath().split(path.delimiter)
      .filter(candidate => candidate.startsWith(path.join(home, '.nvm')));

    expect(nvmCandidates[0]).toBe(activeBin);
    expect(nvmCandidates).toContain(nvmBin);
  });

  it('scans NVM versions newest-first using semantic version ordering', () => {
    fs.unlinkSync(path.join(home, '.nvm', 'alias', 'default'));
    for (const version of ['v22.9.0', 'v23.0.0', 'v24.0.0']) {
      fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', version, 'bin'), { recursive: true });
    }

    const candidates = getEnhancedPath().split(path.delimiter)
      .filter(candidate => candidate.startsWith(path.join(home, '.nvm', 'versions', 'node')));

    expect(candidates).toEqual([
      path.join(home, '.nvm', 'versions', 'node', 'v24.0.0', 'bin'),
      path.join(home, '.nvm', 'versions', 'node', 'v23.0.0', 'bin'),
      nvmBin,
    ]);
  });

  it('matches a partial default alias to its major before newer unrelated versions', () => {
    fs.unlinkSync(path.join(home, '.nvm', 'alias', '22'));
    for (const version of ['v23.0.0', 'v24.0.0']) {
      fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', version, 'bin'), { recursive: true });
    }
    const defaultCli = path.join(nvmBin, 'claude');
    const newerCli = path.join(home, '.nvm', 'versions', 'node', 'v24.0.0', 'bin', 'claude');
    fs.writeFileSync(defaultCli, '');
    fs.writeFileSync(newerCli, '');

    const versionDirs = getEnhancedPath().split(path.delimiter)
      .filter(candidate => candidate.startsWith(path.join(home, '.nvm', 'versions', 'node')));
    expect(versionDirs).toEqual([
      nvmBin,
      path.join(home, '.nvm', 'versions', 'node', 'v24.0.0', 'bin'),
      path.join(home, '.nvm', 'versions', 'node', 'v23.0.0', 'bin'),
    ]);
    expect(findProviderCliPath('claude')).toBe(defaultCli);
  });

  it('prefers a provider already available on the current PATH over NVM fallback copies', () => {
    const activeBin = path.join(home, 'active-node', 'bin');
    fs.mkdirSync(activeBin, { recursive: true });
    const activeCli = path.join(activeBin, 'claude');
    fs.writeFileSync(activeCli, '');
    fs.writeFileSync(path.join(nvmBin, 'claude'), '');
    process.env.PATH = activeBin;

    expect(findProviderCliPath('claude')).toBe(activeCli);
  });

  it('prefers Copilot already available on the current PATH over NVM fallback copies', () => {
    const activeBin = path.join(home, 'active-node', 'bin');
    fs.mkdirSync(activeBin, { recursive: true });
    const activeCli = path.join(activeBin, 'copilot');
    fs.writeFileSync(activeCli, '');
    fs.writeFileSync(path.join(nvmBin, 'copilot'), '');
    process.env.PATH = activeBin;

    expect(findCopilotCLIPath()).toBe(activeCli);
  });

  it('prefers npm already available on the current PATH over NVM fallback npm', () => {
    const activeBin = path.join(home, 'active-node', 'bin');
    fs.mkdirSync(activeBin, { recursive: true });
    const activeNpm = path.join(activeBin, 'npm');
    fs.writeFileSync(activeNpm, '');
    fs.writeFileSync(path.join(nvmBin, 'npm'), '');
    process.env.PATH = activeBin;

    expect(findNpmPath()).toBe(activeNpm);
  });

  it.each(['claude', 'codex'] as const)('finds the NVM-installed %s CLI', (provider) => {
    const cliPath = path.join(nvmBin, provider);
    fs.writeFileSync(cliPath, '');

    expect(findProviderCliPath(provider)).toBe(cliPath);
  });

  it('keeps Copilot detection on the shared NVM candidate resolver', () => {
    const cliPath = path.join(nvmBin, 'copilot');
    fs.writeFileSync(cliPath, '');

    expect(findCopilotCLIPath()).toBe(cliPath);
  });

  it('finds npm from the same NVM PATH when NVM_BIN is absent', () => {
    const npmPath = path.join(nvmBin, 'npm');
    expect(findNpmPath()).toBe(npmPath);
  });

  it('reports success only when the installed CLI is rediscovered', async () => {
    const cliPath = path.join(nvmBin, 'claude');
    const child = makeChild();
    mockedSpawn.mockImplementationOnce(() => {
      process.nextTick(() => {
        fs.writeFileSync(cliPath, '');
        child.emit('close', 0);
      });
      return child as unknown as ReturnType<typeof spawn>;
    });

    const result = await startProviderInstall('claude', () => undefined).done;

    expect(mockedSpawn).toHaveBeenCalledWith(path.join(nvmBin, 'npm'), ['install', '-g', '@anthropic-ai/claude-code'], expect.objectContaining({
      env: expect.objectContaining({ PATH: expect.stringContaining(nvmBin) }),
    }));
    expect(result).toEqual({ success: true, cliPath });
  });

  it('does not report success when npm exits zero but the CLI is missing', async () => {
    const child = makeChild();
    mockedSpawn.mockImplementationOnce(() => {
      process.nextTick(() => child.emit('close', 0));
      return child as unknown as ReturnType<typeof spawn>;
    });

    const result = await startProviderInstall('claude', () => undefined).done;

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining('설치는 완료됐지만 설치된 CLI를 찾지 못했습니다.'),
    });
  });
});

function makeChild(): EventEmitter & { stdout: EventEmitter & { destroy: jest.Mock }; stderr: EventEmitter & { destroy: jest.Mock }; unref: jest.Mock } {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { destroy: jest.Mock };
    stderr: EventEmitter & { destroy: jest.Mock };
    unref: jest.Mock;
  };
  child.stdout = Object.assign(new EventEmitter(), { destroy: jest.fn() });
  child.stderr = Object.assign(new EventEmitter(), { destroy: jest.fn() });
  child.unref = jest.fn();
  return child;
}
