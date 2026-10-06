/**
 * Windows hands a process one command line, not an argv. Node (libuv) builds it by
 * quoting each argument, and CreateProcessW refuses one longer than its cap. The
 * prompt travels as an argument, so a long conversation or note can exceed it; this
 * measures the line exactly so the caller can explain that instead of a raw spawn error.
 */

import * as path from 'path';

/** CreateProcessW `lpCommandLine` cap in UTF-16 units, including the terminating NUL. */
export const WINDOWS_COMMAND_LINE_MAX = 32767;

/** libuv quote_cmd_arg (src/win/process.c), the quoting Node uses on Windows. */
export function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""';
  if (!/[ \t"]/.test(arg)) return arg;
  if (!/["\\]/.test(arg)) return `"${arg}"`;
  let quoted = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes += 1;
      continue;
    }
    // Backslashes are literal unless they precede a quote, which they must then escape too.
    quoted += ch === '"' ? '\\'.repeat(backslashes * 2 + 1) + '"' : '\\'.repeat(backslashes) + ch;
    backslashes = 0;
  }
  return quoted + '\\'.repeat(backslashes * 2) + '"';
}

/** Length in UTF-16 units (JS `.length`), so Korean counts 1 and an emoji 2. */
export function windowsCommandLineLength(command: string, args: readonly string[]): number {
  return args.reduce((total, arg) => total + 1 + quoteWindowsArg(arg).length, quoteWindowsArg(command).length);
}

export function fitsWindowsCommandLine(command: string, args: readonly string[]): boolean {
  return windowsCommandLineLength(command, args) + 1 <= WINDOWS_COMMAND_LINE_MAX;
}

/** Windows PowerShell by absolute path: Obsidian's inherited PATH is not trustworthy. */
export function windowsPowerShellPath(systemRoot: string | undefined = process.env.SystemRoot): string {
  return path.join(systemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
