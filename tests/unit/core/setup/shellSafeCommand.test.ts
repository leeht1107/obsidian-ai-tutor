import { shellSafeCommand } from '@/core/setup/AutoSetupService';

describe('shellSafeCommand', () => {
  it('quotes a Windows npm path with spaces when it runs through the shell', () => {
    // Node's default install dir: unquoted, cmd.exe reads only "C:\Program" as the command.
    expect(shellSafeCommand('C:\\Program Files\\nodejs\\npm.cmd', true))
      .toBe('"C:\\Program Files\\nodejs\\npm.cmd"');
  });

  it('leaves paths without spaces, and non-shell spawns, untouched', () => {
    expect(shellSafeCommand('C:\\nodejs\\npm.cmd', true)).toBe('C:\\nodejs\\npm.cmd');
    expect(shellSafeCommand('/opt/homebrew/bin/npm', false)).toBe('/opt/homebrew/bin/npm');
    expect(shellSafeCommand('C:\\Program Files\\nodejs\\npm.cmd', false)).toBe('C:\\Program Files\\nodejs\\npm.cmd');
  });
});
