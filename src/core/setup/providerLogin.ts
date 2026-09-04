/**
 * Drives a provider CLI's login from inside Obsidian.
 *
 * The plugin used to print `codex login` and tell the student to go find a
 * terminal. That was wrong: spawned headless with stdin piped and no TTY,
 * `codex login --device-auth` prints a URL and a one-time code and waits.
 * Verified on 2026-09-04 — see install-login-evidence.md.
 *
 * Two shapes are supported:
 *  - device code: the CLI prints a URL + code, the student enters the code in a
 *    browser, the CLI exits on its own.
 *  - paste back:  the CLI prints a URL, the browser hands the student a code,
 *    the student pastes it and it is written to the child's stdin.
 *
 * Whatever happens, the CLI's own output is surfaced verbatim. Parsing is an
 * overlay, never the only thing the student is shown, because two of the four
 * CLIs' login output could not be captured here.
 */

import { type ChildProcess,spawn } from 'child_process';

import { getEnhancedPath } from '../../utils/env';
import { findProviderCliPath, type ProviderId } from '../providers/providerRegistry';
import { isWindows, killTree } from './processTree';

/** Terminal colour codes; the CLIs emit them even when stdout is a pipe. */
// eslint-disable-next-line no-control-regex -- matching the ESC byte is the point
const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export interface LoginRecipe {
  args: readonly string[];
  /** Whether the flow ends by the student pasting a code back into the CLI. */
  expectsPastedCode: boolean;
}

/**
 * agy is absent on purpose: it has no login command at all, so there is nothing
 * to drive and the wizard must send the student to a real terminal. It is the
 * only provider for which that instruction is honest.
 */
const RECIPES: Partial<Record<ProviderId, LoginRecipe>> = {
  // Verified: prints the URL and code, no TTY needed, exits on its own.
  codex: { args: ['login', '--device-auth'], expectsPastedCode: false },
  // Documented device-code flow; output shape not captured on this machine.
  copilot: { args: ['login', '--device-code'], expectsPastedCode: false },
  // Browser flow that hands back a code to paste. Not re-run here: this machine's
  // claude credentials are in use by the session that built the feature.
  claude: { args: ['auth', 'login'], expectsPastedCode: true },
};

export function getLoginRecipe(providerId: ProviderId): LoginRecipe | undefined {
  return RECIPES[providerId];
}

export function canDriveLogin(providerId: ProviderId): boolean {
  return RECIPES[providerId] !== undefined;
}

export interface DeviceCode {
  url?: string;
  code?: string;
}

/**
 * Pull a verification URL and one-time code out of login output.
 *
 * Deliberately shape-driven rather than per-CLI: codex is the only login output
 * captured here, so a codex-specific parser would leave the other CLIs with
 * nothing. A code is a short hyphenated uppercase token — that matches codex's
 * `UGAG-7PSZA` and GitHub's `ABCD-1234` without matching prose.
 */
export function parseDeviceCode(rawOutput: string): DeviceCode {
  const text = stripAnsi(rawOutput);
  const url = text.match(/https?:\/\/[^\s<>"')]+/)?.[0];
  const code = text.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/)?.[0];
  return { url, code };
}

export type LoginEvent =
  | { type: 'output'; text: string }
  | { type: 'device-code'; url?: string; code?: string };

export interface LoginOutcome {
  /** The CLI exited 0. Confirm separately with checkProviderReadiness. */
  success: boolean;
  exitCode: number | null;
  output: string;
  error?: string;
}

export interface LoginSession {
  /** Write a code the student pasted from the browser into the CLI's stdin. */
  submitCode(code: string): void;
  /** Give up on the login and kill the CLI. */
  cancel(): void;
  done: Promise<LoginOutcome>;
}

/**
 * Spawn a provider's login and stream what it says.
 *
 * Resolves rather than rejects on every failure path: this drives a modal the
 * student is watching, and an unhandled rejection there would strand them on a
 * spinner.
 */
export function startProviderLogin(
  providerId: ProviderId,
  onEvent: (event: LoginEvent) => void,
  options: { cliPath?: string; timeoutMs?: number; env?: Record<string, string> } = {}
): LoginSession {
  const recipe = RECIPES[providerId];
  const cliPath = findProviderCliPath(providerId, options.cliPath);

  if (!recipe || !cliPath) {
    const error = !recipe
      ? '이 CLI에는 로그인 명령이 없습니다.'
      : 'CLI를 찾을 수 없습니다.';
    return {
      submitCode: () => { /* nothing to write to */ },
      cancel: () => { /* nothing to kill */ },
      done: Promise.resolve({ success: false, exitCode: null, output: '', error }),
    };
  }

  // Device-code links expire (codex says 15 minutes); allow a real person's pace.
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;

  let settled = false;
  let output = '';
  let announcedCode = false;
  let resolveDone: (outcome: LoginOutcome) => void;
  const done = new Promise<LoginOutcome>((resolve) => { resolveDone = resolve; });

  const finish = (outcome: LoginOutcome) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveDone(outcome);
  };

  const child: ChildProcess = spawn(cliPath, [...recipe.args], {
    env: { ...process.env, ...options.env, PATH: getEnhancedPath() },
    stdio: ['pipe', 'pipe', 'pipe'],
    // Own the whole tree: a login CLI spawns helpers, and killing only the
    // direct pid leaves them running after a cancel or a timeout.
    detached: !isWindows,
  });

  /** Idempotent: closing every stream is what lets the event loop drain. */
  const teardown = () => {
    child.stdin?.end();
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    killTree(child);
    child.unref();
  };

  const timer = setTimeout(() => {
    teardown();
    finish({ success: false, exitCode: null, output, error: '로그인 시간이 초과됐습니다.' });
  }, timeoutMs);

  const consume = (chunk: Buffer) => {
    const text = stripAnsi(chunk.toString());
    output += text;
    onEvent({ type: 'output', text });
    if (!announcedCode) {
      const { url, code } = parseDeviceCode(output);
      // A paste-back CLI never prints a code — the browser gives it to the
      // student — so requiring both would hide the only link they have and
      // strand them on the waiting screen. A device-code CLI does print both,
      // and there waiting avoids announcing a URL before its code arrives.
      const ready = recipe.expectsPastedCode ? Boolean(url) : Boolean(url && code);
      if (ready) {
        announcedCode = true;
        onEvent({ type: 'device-code', url, code });
      }
    }
  };

  child.stdout?.on('data', consume);
  child.stderr?.on('data', consume);

  child.on('error', (err: Error) => {
    finish({ success: false, exitCode: null, output, error: err.message });
  });
  child.on('close', (exitCode) => {
    finish({ success: exitCode === 0, exitCode, output });
  });

  return {
    submitCode(code: string) {
      if (settled) return;
      child.stdin?.write(`${code.trim()}\n`);
    },
    cancel() {
      if (settled) return;
      teardown();
      finish({ success: false, exitCode: null, output, error: '사용자가 취소했습니다.' });
    },
    done,
  };
}
