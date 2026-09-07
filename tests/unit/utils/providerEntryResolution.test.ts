/**
 * The ladder that replaces `shell: true` on Windows.
 *
 * Why this exists: with `shell: true`, Node hands cmd.exe one command string and
 * escapes nothing, so a prompt built from note content (`& calc`, `%PATH%`, `^`)
 * becomes a command. The fix is to never ask for a shell — which means we must be
 * able to name a real executable in every case a student can land in.
 *
 * Four rungs, all deterministic lookups rather than guesses:
 *   0. an .exe is already directly spawnable
 *   1. parse the .cmd shim text for its .js target (npm's own format)
 *   2. resolve the npm package layout to the package.json `bin` entry
 *   3. a sibling .exe next to an unusable shim
 * Nothing resolves -> null, and the caller shows a Korean notice instead of
 * falling back to a shell.
 *
 * No Windows machine was available; these pin the resolution order and the
 * layouts, not the spawn itself.
 */
import * as fs from 'fs';

import { resolveProviderEntry } from '@/utils/copilotCli';

const NPM_BIN = 'C:\\Users\\s\\AppData\\Roaming\\npm';
const PKG = '@anthropic-ai/claude-code';
const PKG_ROOT = `${NPM_BIN}\\node_modules\\@anthropic-ai\\claude-code`;

/** Mock a Windows filesystem holding exactly `files` (path -> contents). */
function mockWindowsFs(files: Record<string, string>): void {
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
}

describe('resolveProviderEntry — the no-shell ladder', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform);
    jest.restoreAllMocks();
  });

  it('passes a non-Windows path straight through', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    expect(resolveProviderEntry('/opt/homebrew/bin/claude', PKG)).toEqual(['/opt/homebrew/bin/claude', []]);
  });

  it('spawns an .exe directly instead of asking for a shell', () => {
    // The old condition was `shell: !cmdShim && win32`, and resolveCmdShim only
    // reads .cmd — so an .exe, which needs no shell at all, switched one on.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({ [`${NPM_BIN}\\claude.exe`]: '' });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.exe`, PKG)).toEqual([`${NPM_BIN}\\claude.exe`, []]);
  });

  it('rung 1: reads the .js target out of a parseable npm shim', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: '@echo off\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js"  %*\r\n',
      [`${NPM_BIN}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual([
      'node',
      [`${NPM_BIN}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`],
    ]);
  });

  it('rung 2: falls back to the package layout when the shim text is unreadable', () => {
    // pnpm, yarn and bun all write a different shim body. Rather than learn each
    // format, follow npm's published layout to the package.json `bin` field.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: '@echo off\r\nsomething we have never seen\r\n',
      [`${PKG_ROOT}\\package.json`]: JSON.stringify({ name: PKG, bin: { claude: 'cli.js' } }),
      [`${PKG_ROOT}\\cli.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual(['node', [`${PKG_ROOT}\\cli.js`]]);
  });

  it('rung 2: accepts a string `bin` as well as the object form', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: 'unparseable',
      [`${PKG_ROOT}\\package.json`]: JSON.stringify({ name: PKG, bin: './bin/entry.js' }),
      [`${PKG_ROOT}\\bin\\entry.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual(['node', [`${PKG_ROOT}\\bin\\entry.js`]]);
  });

  it('prefers a node.exe sitting beside the shim over a bare `node`', () => {
    // nvm-windows ships node.exe next to the shims, and a bare `node` may resolve
    // to a different version than the one the CLI was installed under.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: 'unparseable',
      [`${NPM_BIN}\\node.exe`]: '',
      [`${PKG_ROOT}\\package.json`]: JSON.stringify({ bin: { claude: 'cli.js' } }),
      [`${PKG_ROOT}\\cli.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual([
      `${NPM_BIN}\\node.exe`,
      [`${PKG_ROOT}\\cli.js`],
    ]);
  });

  it('rung 3: uses a sibling .exe when neither the shim nor the package resolves', () => {
    // volta and scoop write a .cmd next to a real .exe.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: 'unparseable',
      [`${NPM_BIN}\\claude.exe`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual([`${NPM_BIN}\\claude.exe`, []]);
  });

  it('returns null rather than a shell when every rung fails', () => {
    // This is the whole point: the absence of an answer must reach the caller as
    // an absence, so it can show a student a Korean notice and the setup wizard.
    // Answering with `shell: true` here is what put note content on a command line.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({ [`${NPM_BIN}\\claude.cmd`]: 'unparseable' });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toBeNull();
  });

  it('returns null for a provider with no npm package once the shim fails', () => {
    // agy is manual-setup and has no npm package to fall back to.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({ [`${NPM_BIN}\\agy.cmd`]: 'unparseable' });
    expect(resolveProviderEntry(`${NPM_BIN}\\agy.cmd`, undefined)).toBeNull();
  });

  it('ignores a package.json whose `bin` entry does not exist on disk', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: 'unparseable',
      [`${PKG_ROOT}\\package.json`]: JSON.stringify({ bin: { claude: 'missing.js' } }),
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toBeNull();
  });
});

describe('resolveProviderEntry — findings from the peer review', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');

  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform);
    jest.restoreAllMocks();
  });

  it('reads a shim that spells the directory as %~dp0', () => {
    // npm sets `dp0` from `%~dp0` and then writes `%dp0%`; other cmd-shim
    // generators (pnpm, older yarn) write `%~dp0` straight into the line.
    // Only recognising npm's spelling refuses a working install.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: '@ECHO off\r\n"%_prog%"  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n',
      [`${PKG_ROOT}\\cli.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual(['node', [`${PKG_ROOT}\\cli.js`]]);
  });

  it('resolves a shim target that walks up out of the bin directory', () => {
    // npm's own template points at "%dp0%\..\<pkg>\cli.js" when the shims sit in
    // a nested .bin directory. The `..` has to survive to a real path.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\.bin\\claude.cmd`]: '"%_prog%"  "%dp0%\\..\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
      [`${NPM_BIN}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\.bin\\claude.cmd`, PKG)).toEqual([
      'node',
      [`${PKG_ROOT}\\cli.js`],
    ]);
  });

  it('reads a .cjs or .mjs entry, not only .js', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: '"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.mjs" %*',
      [`${PKG_ROOT}\\cli.mjs`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual(['node', [`${PKG_ROOT}\\cli.mjs`]]);
  });

  it('runs a compiled bin entry directly instead of feeding it to node', () => {
    // A package may ship a prebuilt binary rather than a script; `node cli.exe`
    // fails on the first byte.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: 'unparseable',
      [`${PKG_ROOT}\\package.json`]: JSON.stringify({ bin: { claude: 'bin/claude.exe' } }),
      [`${PKG_ROOT}\\bin\\claude.exe`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual([`${PKG_ROOT}\\bin\\claude.exe`, []]);
  });

  it('matches the bin key without regard to case, as Windows paths are', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\Claude.CMD`]: 'unparseable',
      [`${PKG_ROOT}\\package.json`]: JSON.stringify({ bin: { 'claude-setup': 'setup.js', claude: 'cli.js' } }),
      [`${PKG_ROOT}\\cli.js`]: '',
      [`${PKG_ROOT}\\setup.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\Claude.CMD`, PKG)).toEqual(['node', [`${PKG_ROOT}\\cli.js`]]);
  });

  it('refuses rather than guessing when several bins exist and none matches', () => {
    // Taking the first key would run a package's setup or helper script in place
    // of its CLI, with the student's prompt attached.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: 'unparseable',
      [`${PKG_ROOT}\\package.json`]: JSON.stringify({ bin: { 'claude-setup': 'setup.js', 'claude-doctor': 'doctor.js' } }),
      [`${PKG_ROOT}\\setup.js`]: '',
      [`${PKG_ROOT}\\doctor.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toBeNull();
  });

  it('still uses a lone bin entry whose name does not match the command', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mockWindowsFs({
      [`${NPM_BIN}\\claude.cmd`]: 'unparseable',
      [`${PKG_ROOT}\\package.json`]: JSON.stringify({ bin: { 'claude-code': 'cli.js' } }),
      [`${PKG_ROOT}\\cli.js`]: '',
    });
    expect(resolveProviderEntry(`${NPM_BIN}\\claude.cmd`, PKG)).toEqual(['node', [`${PKG_ROOT}\\cli.js`]]);
  });
});
