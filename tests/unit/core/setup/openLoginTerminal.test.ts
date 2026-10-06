/**
 * agy has no login subcommand: it signs in from its own interactive screen, which
 * needs a real console. `start` makes one on Windows; Terminal does on macOS.
 */
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn() }));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

import { openLoginTerminal } from '@/core/setup/providerLogin';

const spawnMock = spawn as unknown as jest.Mock;

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => Object.assign(new EventEmitter(), { unref: jest.fn() }));
});

describe('openLoginTerminal', () => {
  // cmd.exe would read `&`, `^` or `%` in an unquoted profile path as syntax, so the path
  // never reaches a command line: PowerShell's Start-Process takes it from the environment.
  it.each([
    'C:\\Users\\A&B\\AppData\\Local\\agy\\bin\\agy.exe',
    'C:\\Users\\홍 길동\\AppData\\Local\\agy\\bin\\agy.exe',
    "C:\\Users\\o'b%x%^y\\agy.exe",
  ])('opens a new console for %s without putting the path on a command line', (cliPath) => {
    expect(openLoginTerminal(cliPath, 'win32', 'C:\\Windows')).toBe(true);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe(path.join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:OCOP_LOGIN_CLI']);
    expect(args.join(' ')).not.toContain(cliPath);
    expect(options).toMatchObject({ windowsHide: true, detached: true, stdio: 'ignore' });
    expect(options.env.OCOP_LOGIN_CLI).toBe(cliPath);
  });

  it('opens Terminal on macOS', () => {
    expect(openLoginTerminal('/Users/s/.local/bin/agy', 'darwin')).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith('open', ['-a', 'Terminal', '/Users/s/.local/bin/agy'], {
      detached: true, stdio: 'ignore',
    });
  });

  it('declines on other platforms', () => {
    expect(openLoginTerminal('/usr/bin/agy', 'linux')).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reports failure when spawn throws', () => {
    spawnMock.mockImplementation(() => { throw new Error('EACCES'); });
    expect(openLoginTerminal('C:\\agy.exe', 'win32', 'C:\\Windows')).toBe(false);
  });
});
