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
    // Neither CLI exposes a status command; guessing would recreate the lying badge.
    expect(hasLoginCheck('copilot')).toBe(false);
    expect(hasLoginCheck('agy')).toBe(false);
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

describe('readiness labels', () => {
  it('never labels an unverified provider as ready', () => {
    const { readinessLabel } = jest.requireActual('@/core/setup/providerReadiness');
    expect(readinessLabel('logged-in')).toBe('로그인됨');
    expect(readinessLabel('logged-out')).toBe('로그인 필요');
    expect(readinessLabel('cli-missing')).toBe('설치 필요');
    // The old badge said 준비됨 here, which is the whole bug.
    expect(readinessLabel('unknown')).toBe('확인 불가');
  });

  it('marks only a confirmed login as good', () => {
    const { isReadyState } = jest.requireActual('@/core/setup/providerReadiness');
    expect(isReadyState('logged-in')).toBe(true);
    expect(isReadyState('logged-out')).toBe(false);
    expect(isReadyState('unknown')).toBe(false);
    expect(isReadyState('cli-missing')).toBe(false);
  });
});
