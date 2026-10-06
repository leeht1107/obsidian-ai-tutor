/**
 * The prompt is one argument, and Windows caps a whole command line, so a long
 * conversation or note must stop with an explanation before spawn instead of the
 * raw "Failed to start" error. Windows is simulated: no Windows host runs these.
 */
jest.mock('@/core/setup/processTree', () => ({ isWindows: true, killTree: jest.fn() }));

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

function makeService(
  cliPath: string,
  vaultPath: string,
  logError: jest.Mock,
  provider: 'agy' | 'copilot' = 'agy',
): CopilotBridgeService {
  const fakePlugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      selectedProvider: provider,
      providerCliPaths: { [provider]: cliPath },
      copilotCliPath: cliPath,
    },
    app: { vault: { adapter: { basePath: vaultPath } } },
    getActiveEnvironmentVariables: () => '',
  } as unknown as ObsidianCopilotPlugin;
  const service = new CopilotBridgeService(fakePlugin);
  (service as unknown as { logError: jest.Mock }).logError = logError;
  return service;
}

describe('the Windows command-line gate', () => {
  let tmpDir: string;
  let cliPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-command-line-gate-'));
    if (process.platform === 'win32') {
      // A real Windows host only runs a real executable; any .exe will do, since the
      // gate must stop the request before it is spawned.
      cliPath = path.join(tmpDir, 'agy.exe');
      // A copy, not a hard link: Windows will not delete a link to the running node.exe.
      fs.copyFileSync(process.execPath, cliPath);
    } else {
      cliPath = path.join(tmpDir, 'agy');
      fs.writeFileSync(cliPath, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(cliPath, 0o755);
    }
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not spawn agy when the prompt cannot fit a Windows command line', async () => {
    const spawnSpy = jest.spyOn(childProcess, 'spawn');
    const logError = jest.fn();
    const service = makeService(cliPath, tmpDir, logError);

    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('가'.repeat(33000))) chunks.push(chunk);

    expect(spawnSpy.mock.calls.filter((call) => String(call[0]) === cliPath)).toHaveLength(0);
    expect(chunks.some((chunk) => chunk.type === 'error' && chunk.content.includes('너무 길'))).toBe(true);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ provider: 'agy', stage: 'launch' }));
  });

  it('does not spawn copilot with a prompt that cannot fit a Windows command line', async () => {
    const spawnSpy = jest.spyOn(childProcess, 'spawn');
    const logError = jest.fn();
    const service = makeService(cliPath, tmpDir, logError, 'copilot');
    const prompt = '가'.repeat(33000);

    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query(prompt)) chunks.push(chunk);

    const withPrompt = spawnSpy.mock.calls.filter((call) => (call[1] as string[] | undefined)?.some((arg) => arg.includes(prompt)));
    expect(withPrompt).toHaveLength(0);
    expect(chunks.some((chunk) => chunk.type === 'error' && chunk.content.includes('너무 길'))).toBe(true);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ provider: 'copilot', stage: 'launch' }));
  });
});
