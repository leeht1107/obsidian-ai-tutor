/**
 * agy has no npm package: the wizard runs its official installer script, only after
 * the student presses 설치 시작. The installer must run through an absolute shell
 * path (Obsidian's PATH is not trustworthy), never through `shell: true`, and with
 * stdin closed so a prompting installer exits instead of hanging the wizard.
 */
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn() }));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

import { resolveInstallSpawn, startProviderInstall } from '@/core/setup/AutoSetupService';

const spawnMock = spawn as unknown as jest.Mock;

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = jest.fn();
  child.kill = jest.fn();
  return child;
}

describe('resolveInstallSpawn for agy', () => {
  it('runs the official PowerShell installer from System32 on Windows, UTF-8 output', () => {
    const spawnSpec = resolveInstallSpawn('agy', 'win32', 'C:\\Windows');
    expect(spawnSpec).toEqual({
      command: path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; irm https://antigravity.google/cli/install.ps1 | iex',
      ],
      shell: false,
      detached: false,
      label: 'PowerShell',
    });
  });

  it('runs the official shell installer through /bin/bash on macOS', () => {
    expect(resolveInstallSpawn('agy', 'darwin')).toEqual({
      command: '/bin/bash',
      args: ['-c', 'curl -fsSL https://antigravity.google/cli/install.sh | bash'],
      shell: false,
      detached: true,
      label: 'bash',
    });
  });

  it('has no recipe on other platforms', () => {
    expect(resolveInstallSpawn('agy', 'linux')).toBeNull();
  });
});

describe('startProviderInstall for agy', () => {
  beforeEach(() => spawnMock.mockReset());

  it('spawns the installer with stdin closed and reports a failing exit', async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const session = startProviderInstall('agy', () => undefined);
    const expected = resolveInstallSpawn('agy');
    expect(expected).not.toBeNull();

    expect(spawnMock).toHaveBeenCalledWith(expected!.command, expected!.args, expect.objectContaining({
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    child.emit('close', 1);
    await expect(session.done).resolves.toMatchObject({ success: false, error: `${expected!.label} exited with code 1` });
  });
});
