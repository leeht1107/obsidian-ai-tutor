import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { checkProviderReadiness, hasLoginCheck } from '@/core/setup/providerReadiness';

/**
 * Fixture CLIs emit the byte-for-byte output the real CLIs printed on
 * 2026-09-04 (see install-login-evidence.md), so these tests prove the
 * interpretation of real output shapes rather than of invented ones.
 */

const isWindows = process.platform === 'win32';

/** Real `claude auth status` output, logged in. */
const CLAUDE_LOGGED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'someone@example.com',
  subscriptionType: 'max',
});
const CLAUDE_LOGGED_OUT = JSON.stringify({ loggedIn: false });

/** Writes a CLI whose answer goes to stdout and whose noise goes to stderr. */
function writeNoisyCli(dir: string, name: string, stdout: string, stderr: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' '${stderr}' >&2\ncat <<'OUT'\n${stdout}\nOUT\nexit 0\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

function writeCli(dir: string, name: string, stdout: string, exitCode = 0): string {
  if (isWindows) {
    const p = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(p, `@echo off\r\necho ${stdout}\r\nexit /b ${exitCode}\r\n`);
    return p;
  }
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\ncat <<'OUT'\n${stdout}\nOUT\nexit ${exitCode}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

describe('provider readiness — real login checks', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('knows which CLIs can answer at all', () => {
    expect(hasLoginCheck('claude')).toBe(true);
    expect(hasLoginCheck('codex')).toBe(true);
    // agy has no auth command, which is why it was once listed as unaskable.
    // `agy models` asks the account anyway: verified 2026-09-05, it printed a
    // model list when signed in and "Please sign in to view available models."
    // under a fresh HOME.
    expect(hasLoginCheck('agy')).toBe(true);
    // copilot still cannot be asked. Every non-interactive subcommand answers
    // from local files — identical output under a fresh HOME — and its only
    // account-backed surfaces are interactive. Guessing from a credential file
    // would recreate the lying badge.
    expect(hasLoginCheck('copilot')).toBe(false);
  });

  it('reads claude JSON as logged in', async () => {
    const cli = writeCli(dir, 'claude-in', CLAUDE_LOGGED_IN);
    await expect(checkProviderReadiness('claude', { cliPath: cli }))
      .resolves.toMatchObject({ state: 'logged-in' });
  });

  it('reads claude JSON as logged out', async () => {
    const cli = writeCli(dir, 'claude-out', CLAUDE_LOGGED_OUT);
    await expect(checkProviderReadiness('claude', { cliPath: cli }))
      .resolves.toMatchObject({ state: 'logged-out' });
  });

  it('treats unparseable claude output as unknown, never as ready', async () => {
    const cli = writeCli(dir, 'claude-junk', 'command not found: something');
    await expect(checkProviderReadiness('claude', { cliPath: cli }))
      .resolves.toMatchObject({ state: 'unknown' });
  });

  it('reads codex "Not logged in" as logged out even though it exits non-zero', async () => {
    const cli = writeCli(dir, 'codex-out', 'Not logged in', 1);
    await expect(checkProviderReadiness('codex', { cliPath: cli }))
      .resolves.toMatchObject({ state: 'logged-out' });
  });

  it('reads codex success as logged in', async () => {
    const cli = writeCli(dir, 'codex-in', 'Logged in using ChatGPT', 0);
    await expect(checkProviderReadiness('codex', { cliPath: cli }))
      .resolves.toMatchObject({ state: 'logged-in' });
  });

  it('reads claude JSON even when the CLI writes a warning to stderr', async () => {
    if (isWindows) return;
    // stderr used to be concatenated onto stdout before JSON.parse, so a single
    // deprecation notice turned a logged-in user into 확인 불가.
    const cli = writeNoisyCli(dir, 'claude-noisy', CLAUDE_LOGGED_IN, '(node:1) DeprecationWarning: x');
    await expect(checkProviderReadiness('claude', { cliPath: cli }))
      .resolves.toMatchObject({ state: 'logged-in' });
  });

  it('still reads codex prose when it lands on stderr', async () => {
    if (isWindows) return;
    const cli = writeNoisyCli(dir, 'codex-stderr', '', 'Not logged in');
    await expect(checkProviderReadiness('codex', { cliPath: cli }))
      .resolves.toMatchObject({ state: 'logged-out' });
  });

  it('reports a missing binary as cli-missing, not as logged out', async () => {
    await expect(checkProviderReadiness('claude', { cliPath: path.join(dir, 'nope') }))
      .resolves.toMatchObject({ state: 'cli-missing' });
  });

  it('reports copilot as unknown because it has no status command', async () => {
    const cli = writeCli(dir, 'copilot-any', 'anything at all');
    await expect(checkProviderReadiness('copilot', { cliPath: cli }))
      .resolves.toMatchObject({ state: 'unknown' });
  });

  it('does not hang the badge on a CLI that never exits', async () => {
    if (isWindows) return;
    const p = path.join(dir, 'claude-hang');
    fs.writeFileSync(p, '#!/bin/sh\nsleep 30\n');
    fs.chmodSync(p, 0o755);
    const started = Date.now();
    await expect(checkProviderReadiness('claude', { cliPath: p, timeoutMs: 300 }))
      .resolves.toMatchObject({ state: 'unknown' });
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('readiness probe cancellation', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-abort-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('stops a probe as soon as the caller aborts, without waiting for the timeout', async () => {
    if (process.platform === 'win32') return;
    const p = path.join(dir, 'claude-slow');
    fs.writeFileSync(p, '#!/bin/sh\nsleep 30\n');
    fs.chmodSync(p, 0o755);

    const controller = new AbortController();
    const started = Date.now();
    const pending = checkProviderReadiness('claude', {
      cliPath: p, timeoutMs: 30000, signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toMatchObject({ state: 'unknown' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('does not spawn at all when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(checkProviderReadiness('claude', {
      cliPath: path.join(dir, 'anything'), signal: controller.signal,
    })).resolves.toMatchObject({ state: 'cli-missing' });
  });
});
