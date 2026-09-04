/**
 * Real login checks for the provider CLIs.
 *
 * The provider badge used to be driven by `findProviderCliPath`, i.e. "a binary
 * exists". A logged-out CLI still showed green and only failed when the student
 * pressed send. These probes ask the CLI itself.
 *
 * Every command and every output shape below was captured from the installed
 * CLI on 2026-09-04 with stdin closed and no TTY — the conditions a child
 * spawned from Obsidian actually gets. See
 * .claude/artifacts/provider-model-ux-20260904/install-login-evidence.md
 */

import { spawn } from 'child_process';

import { getEnhancedPath } from '../../utils/env';
import { findProviderCliPath, type ProviderId } from '../providers/providerRegistry';
import { isWindows, killTree } from './processTree';

export type LoginState =
  /** The CLI says it is authenticated. */
  | 'logged-in'
  /** The CLI says it is not authenticated. */
  | 'logged-out'
  /** No binary on PATH. */
  | 'cli-missing'
  /** The CLI offers no way to ask, or the answer could not be read. */
  | 'unknown';

/** How to ask one CLI whether it is logged in, and how to read the answer. */
interface ReadinessProbe {
  args: readonly string[];
  /**
   * `stdout` is kept separate from `stderr` because claude's answer is JSON:
   * a deprecation notice or a node warning on stderr would otherwise be
   * concatenated into it and make a logged-in user parse as unknown.
   */
  interpret(stdout: string, stderr: string, exitCode: number | null): LoginState;
}

/**
 * copilot and agy are deliberately absent.
 *
 * copilot has `login` but no status subcommand at all — `copilot --help` lists
 * app/completion/help/init/login/mcp/plugin/plugins/skill/update/version.
 * agy has no auth surface whatsoever: `agy auth status` answers
 * `Error: unexpected argument "auth".`
 *
 * Neither absence is a failure to report, so both stay 'unknown' rather than
 * being guessed at from a credential file or a keychain entry.
 */
const PROBES: Partial<Record<ProviderId, ReadinessProbe>> = {
  claude: {
    // Prints JSON: {"loggedIn":true,"authMethod":"claude.ai","email":...}
    args: ['auth', 'status'],
    interpret(stdout) {
      try {
        const parsed: unknown = JSON.parse(stdout.trim());
        if (parsed && typeof parsed === 'object' && 'loggedIn' in parsed) {
          return (parsed as { loggedIn: unknown }).loggedIn === true ? 'logged-in' : 'logged-out';
        }
      } catch { /* not JSON — fall through */ }
      return 'unknown';
    },
  },
  codex: {
    // Prints `Logged in using ChatGPT` (exit 0) or `Not logged in` (exit 1).
    args: ['login', 'status'],
    interpret(stdout, stderr, exitCode) {
      // codex answers in prose, so either stream is a legitimate place to find it.
      if (/not logged in/i.test(stdout + stderr)) return 'logged-out';
      if (exitCode === 0) return 'logged-in';
      return 'unknown';
    },
  },
};

/** True when the CLI can answer the question at all. */
export function hasLoginCheck(providerId: ProviderId): boolean {
  return PROBES[providerId] !== undefined;
}

export interface ReadinessResult {
  state: LoginState;
  /** Present when the CLI was asked; useful for surfacing the raw answer. */
  output?: string;
}

/**
 * Ask a provider CLI whether it is logged in.
 *
 * Never rejects: a CLI that hangs, crashes or is missing resolves to a state,
 * because this drives a badge and must not be able to break the view.
 */
export async function checkProviderReadiness(
  providerId: ProviderId,
  options: { cliPath?: string; timeoutMs?: number } = {}
): Promise<ReadinessResult> {
  const probe = PROBES[providerId];
  const cliPath = findProviderCliPath(providerId, options.cliPath);
  if (!cliPath) return { state: 'cli-missing' };
  if (!probe) return { state: 'unknown' };

  const timeoutMs = options.timeoutMs ?? 8000;

  return new Promise<ReadinessResult>((resolve) => {
    let settled = false;
    const finish = (result: ReadinessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(cliPath, [...probe.args], {
      env: { ...process.env, PATH: getEnhancedPath() },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own the tree so a status command that spawns a helper cannot outlive
      // the timeout below.
      detached: !isWindows,
    });

    const timer = setTimeout(() => {
      // Detach the streams as well as killing the tree: a killed process whose
      // stdio is still piped keeps the event loop alive.
      child.stdout?.destroy();
      child.stderr?.destroy();
      killTree(child);
      child.unref();
      finish({ state: 'unknown' });
    }, timeoutMs);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', () => finish({ state: 'unknown' }));
    child.on('close', (code) => finish({
      state: probe.interpret(stdout, stderr, code),
      output: `${stdout}${stderr}`.trim(),
    }));
  });
}

/** What the provider menu shows for each state. */
export function readinessLabel(state: LoginState): string {
  switch (state) {
    case 'logged-in': return '로그인됨';
    case 'logged-out': return '로그인 필요';
    case 'cli-missing': return '설치 필요';
    // copilot and agy cannot be asked. Saying so is the point: the previous
    // badge rendered this case as 준비됨 and then failed at send time.
    case 'unknown': return '확인 불가';
  }
}

/** Only a confirmed login counts; an unaskable CLI is not "ready". */
export function isReadyState(state: LoginState): boolean {
  return state === 'logged-in';
}
