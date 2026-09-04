import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  canDriveLogin,
  parseDeviceCode,
  startProviderLogin,
  stripAnsi,
} from '@/core/setup/providerLogin';

const isWindows = process.platform === 'win32';

/**
 * Byte-for-byte what `codex login --device-auth` printed on 2026-09-04 when
 * spawned headless with stdin closed, ANSI colour codes included. Testing the
 * parser against cleaned-up text would pass here and fail on the real CLI.
 */
const CODEX_DEVICE_AUTH_OUTPUT = [
  '',
  'Welcome to Codex [v\u001b[90m0.153.0\u001b[0m]',
  "\u001b[90mOpenAI's command-line coding agent\u001b[0m",
  '',
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '',
  '1. Open this link in your browser and sign in to your account',
  '   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m',
  '',
  '2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m',
  '   \u001b[94mUGAG-7PSZA\u001b[0m',
  '',
  '\u001b[90mContinue only if you started this login in Codex.\u001b[0m',
].join('\n');

function writeCli(dir: string, name: string, body: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  fs.chmodSync(p, 0o755);
  return p;
}

describe('provider login driver', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('knows agy cannot be driven and the others can', () => {
    expect(canDriveLogin('codex')).toBe(true);
    expect(canDriveLogin('claude')).toBe(true);
    expect(canDriveLogin('copilot')).toBe(true);
    // agy has no login command at all, so "open a terminal" is honest only here.
    expect(canDriveLogin('agy')).toBe(false);
  });

  it('strips the colour codes the CLI emits into a pipe', () => {
    expect(stripAnsi('\u001b[94mhttps://x.test\u001b[0m')).toBe('https://x.test');
  });

  it('pulls the URL and one-time code out of real codex output', () => {
    expect(parseDeviceCode(CODEX_DEVICE_AUTH_OUTPUT)).toEqual({
      url: 'https://auth.openai.com/codex/device',
      code: 'UGAG-7PSZA',
    });
  });

  it('does not invent a code out of ordinary prose', () => {
    const prose = 'Open this link and sign in to your account: https://example.test/device';
    const parsed = parseDeviceCode(prose);
    expect(parsed.url).toBe('https://example.test/device');
    expect(parsed.code).toBeUndefined();
  });

  it('reports a provider with no login command without spawning anything', async () => {
    const session = startProviderLogin('agy', () => { /* no events expected */ });
    const outcome = await session.done;
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('\ub85c\uadf8\uc778 \uba85\ub839\uc774 \uc5c6\uc2b5\ub2c8\ub2e4');
  });

  it('announces the device code while the CLI is still running, then succeeds', async () => {
    if (isWindows) return;
    // Prints the real banner, waits, then exits 0 — like the CLI waiting on the
    // browser. Proves the code reaches the UI before the process ends.
    const cli = writeCli(dir, 'codex-login', [
      '#!/bin/sh',
      "printf '%s\\n' \"$BANNER\"",
      'sleep 0.4',
      'exit 0',
    ].join('\n'));
    const events: string[] = [];
    let announced: { url?: string; code?: string } | null = null;
    const session = startProviderLogin('codex', (event) => {
      events.push(event.type);
      if (event.type === 'device-code') announced = { url: event.url, code: event.code };
    }, { cliPath: cli, env: { BANNER: CODEX_DEVICE_AUTH_OUTPUT } });

    const outcome = await session.done;
    expect(announced).toEqual({
      url: 'https://auth.openai.com/codex/device',
      code: 'UGAG-7PSZA',
    });
    expect(events).toContain('output');
    expect(outcome.success).toBe(true);
    expect(outcome.exitCode).toBe(0);
  });

  it('announces the device code only once across many output chunks', async () => {
    if (isWindows) return;
    const cli = writeCli(dir, 'codex-chatty', [
      '#!/bin/sh',
      "printf 'visit https://auth.openai.com/codex/device\\n'",
      "printf 'code UGAG-7PSZA\\n'",
      'sleep 0.1',
      "printf 'still https://auth.openai.com/codex/device UGAG-7PSZA\\n'",
      'exit 0',
    ].join('\n'));
    let announcements = 0;
    const session = startProviderLogin('codex', (event) => {
      if (event.type === 'device-code') announcements += 1;
    }, { cliPath: cli });
    await session.done;
    expect(announcements).toBe(1);
  });

  it('writes a pasted code into the CLI stdin', async () => {
    if (isWindows) return;
    const marker = path.join(dir, 'pasted.txt');
    // Exits 0 only if the code actually arrived on stdin.
    const cli = writeCli(dir, 'claude-login', [
      '#!/bin/sh',
      'read line',
      'printf %s "$line" > "$MARKER"',
      '[ "$line" = "PASTED-CODE" ] || exit 3',
      'exit 0',
    ].join('\n'));
    const session = startProviderLogin('claude', () => { /* ignore */ }, {
      cliPath: cli,
      env: { MARKER: marker },
    });
    session.submitCode('PASTED-CODE');
    const outcome = await session.done;
    expect(fs.readFileSync(marker, 'utf8')).toBe('PASTED-CODE');
    expect(outcome.success).toBe(true);
  });

  it('cancel kills a login that would otherwise wait forever', async () => {
    if (isWindows) return;
    const cli = writeCli(dir, 'codex-forever', '#!/bin/sh\nsleep 60\n');
    const session = startProviderLogin('codex', () => { /* ignore */ }, { cliPath: cli });
    const started = Date.now();
    session.cancel();
    const outcome = await session.done;
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('\ucde8\uc18c');
    expect(Date.now() - started).toBeLessThan(3000);
  });


  it('shows the login URL for a paste-back CLI that never prints a code', async () => {
    if (isWindows) return;
    // claude's browser flow prints a link; the CODE comes from the browser, not
    // stdout. Requiring both left the student on a spinner with no link.
    const cli = writeCli(dir, 'claude-url-only', [
      '#!/bin/sh',
      "printf 'Open this link to sign in:\\n'",
      "printf '  https://claude.ai/oauth/authorize?x=1\\n'",
      'sleep 0.3',
      'exit 0',
    ].join('\n'));
    let announced: { url?: string; code?: string } | null = null;
    const session = startProviderLogin('claude', (event) => {
      if (event.type === 'device-code') announced = { url: event.url, code: event.code };
    }, { cliPath: cli });
    await session.done;
    expect(announced).toEqual({ url: 'https://claude.ai/oauth/authorize?x=1', code: undefined });
  });

  it('kills processes the login CLI started, not just the CLI itself', async () => {
    if (isWindows) return;
    const pidFile = path.join(dir, 'descendant.pid');
    // A login CLI spawns helpers. Killing only the direct pid leaves them alive.
    const cli = writeCli(dir, 'codex-with-helper', [
      '#!/bin/sh',
      'sleep 60 &',
      'echo $! > "$PIDFILE"',
      'wait',
    ].join('\n'));
    const session = startProviderLogin('codex', () => { /* ignore */ }, {
      cliPath: cli,
      env: { PIDFILE: pidFile },
    });
    // Give the fixture a moment to record its helper pid.
    await new Promise((r) => setTimeout(r, 400));
    const descendantPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    expect(Number.isFinite(descendantPid)).toBe(true);

    session.cancel();
    await session.done;
    await new Promise((r) => setTimeout(r, 300));

    let alive = true;
    try { process.kill(descendantPid, 0); } catch { alive = false; }
    expect(alive).toBe(false);
  });

  it('surfaces a non-zero exit instead of reporting success', async () => {
    if (isWindows) return;
    const cli = writeCli(dir, 'codex-fail', '#!/bin/sh\necho "login failed" >&2\nexit 4\n');
    const session = startProviderLogin('codex', () => { /* ignore */ }, { cliPath: cli });
    const outcome = await session.done;
    expect(outcome.success).toBe(false);
    expect(outcome.exitCode).toBe(4);
    expect(outcome.output).toContain('login failed');
  });
});
