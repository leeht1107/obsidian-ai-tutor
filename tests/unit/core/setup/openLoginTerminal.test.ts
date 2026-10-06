/**
 * agy has no login subcommand: it signs in from its own interactive screen, which
 * needs a real console. `start` makes one on Windows; Terminal does on macOS.
 */
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn() }));

import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { openLoginTerminal } from '@/core/setup/providerLogin';

const spawnMock = spawn as unknown as jest.Mock;

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => Object.assign(new EventEmitter(), { unref: jest.fn() }));
});

describe('openLoginTerminal', () => {
  it('opens a new console through start on Windows, path as its own argument', () => {
    const cliPath = 'C:\\Users\\홍 길동\\AppData\\Local\\agy\\bin\\agy.exe';
    expect(openLoginTerminal(cliPath, 'win32')).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith('cmd.exe', ['/d', '/c', 'start', '', cliPath], {
      windowsHide: true, detached: true, stdio: 'ignore',
    });
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
    expect(openLoginTerminal('C:\\agy.exe', 'win32')).toBe(false);
  });
});
