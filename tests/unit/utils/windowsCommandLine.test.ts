import {
  fitsWindowsCommandLine,
  quoteWindowsArg,
  WINDOWS_COMMAND_LINE_MAX,
  windowsCommandLineLength,
} from '@/utils/windowsCommandLine';

describe('quoteWindowsArg', () => {
  // The vectors libuv documents for quote_cmd_arg (src/win/process.c).
  it.each([
    ['hello"world', '"hello\\"world"'],
    ['hello""world', '"hello\\"\\"world"'],
    ['hello\\world', 'hello\\world'],
    ['hello\\\\world', 'hello\\\\world'],
    ['hello\\"world', '"hello\\\\\\"world"'],
    ['hello\\\\"world', '"hello\\\\\\\\\\"world"'],
    ['hello world\\', '"hello world\\\\"'],
    ['', '""'],
    ['plain', 'plain'],
    ['가 나', '"가 나"'],
  ])('quotes %j as %j', (input, expected) => {
    expect(quoteWindowsArg(input)).toBe(expected);
  });
});

describe('windowsCommandLineLength', () => {
  it('counts the quoted command, then a space and the quoted form of each argument', () => {
    // node.exe=8, ' "C:\a b\cli.js"'=1+15, ' -p'=3, ' "가 나"'=1+5
    expect(windowsCommandLineLength('node.exe', ['C:\\a b\\cli.js', '-p', '가 나'])).toBe(8 + 16 + 3 + 6);
  });

  it('fits only while the line and its terminating NUL stay within the CreateProcess cap', () => {
    const command = 'agy.exe';
    const room = WINDOWS_COMMAND_LINE_MAX - 1 - command.length - 1;
    expect(fitsWindowsCommandLine(command, ['x'.repeat(room)])).toBe(true);
    expect(fitsWindowsCommandLine(command, ['x'.repeat(room + 1)])).toBe(false);
  });
});
