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

import { resolveCmdShim } from '../../utils/copilotCli';
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
 * copilot is deliberately absent.
 *
 * copilot has `login` but no status subcommand, and every non-interactive
 * subcommand it does have (mcp, skill, plugin, version) answers from local
 * files without touching the account — checked by running each one under a
 * fresh HOME and getting identical output. Its only account-backed surfaces
 * are the interactive footer and /statusline. So copilot stays 'unknown' here
 * — a login check it cannot answer. Its badge is decided in providerConnection
 * from a stored credential, which is a weaker claim (a token exists) and is
 * labelled as such.
 *
 * agy was in this list too, on the strength of `agy auth status` answering
 * `Error: unexpected argument "auth".` That was the wrong question: agy has
 * no auth command but `agy models` does ask the account, and it says so
 * plainly when signed out. See AGY_MODELS_PROBE.
 */
/**
 * Exported for its own test: agy exits 0 whether or not it is signed in, so
 * the answer lives entirely in the text.
 */
export const AGY_MODELS_PROBE: ReadinessProbe = {
  // The only agy command that asks the account rather than reading local files.
  args: ['models'],
  interpret(stdout, stderr) {
    const output = stdout + stderr;
    if (/please sign in/i.test(output)) return 'logged-out';
    // A model list is tab separated: `gemini-3.8-flash-high\tGemini 3.8 ...`.
    if (/^\S+\t\S/m.test(stdout)) return 'logged-in';
    return 'unknown';
  },
};

const PROBES: Partial<Record<ProviderId, ReadinessProbe>> = {
  agy: AGY_MODELS_PROBE,
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

/**
 * Resolve how to actually launch a probe.
 *
 * npm installs `claude` and `codex` as .cmd shims on Windows, and spawn cannot
 * execute those directly. The request path already routes through
 * resolveCmdShim; this probe did not, so every Windows probe failed to spawn
 * and resolved to 'unknown' — telling a logged-in Windows student 확인 불가.
 */
export function resolveProbeCommand(cliPath: string, args: readonly string[]): [string, string[]] {
  const shim = resolveCmdShim(cliPath);
  return shim ? [shim[0], [shim[1], ...args]] : [cliPath, [...args]];
}

/** True when the CLI can answer the question at all. */
export function hasLoginCheck(providerId: ProviderId): boolean {
  return PROBES[providerId] !== undefined;
}

export interface ReadinessResult {
  state: LoginState;
  /** Present when the CLI was asked; useful for surfacing the raw answer. */
  output?: string;
}

/** What a finished probe process said. */
export interface ProbeRun {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Run one short command and collect what it said.
 *
 * Never rejects, and answers `null` rather than throwing when the command
 * could not be run to completion — spawn threw, the process errored, the
 * timeout fired, or the caller aborted. Every caller drives a badge and must
 * not be able to break the view it draws.
 *
 * Shared with the copilot credential check so that only one place in this
 * codebase spawns a status command, with one set of timeout, process-tree and
 * Windows rules.
 */
export async function runProbeProcess(
  command: string,
  args: readonly string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ProbeRun | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  // Closing the wizard should not leave a CLI running for the rest of the timeout.
  if (options.signal?.aborted) return null;

  return new Promise<ProbeRun | null>((resolve) => {
    let settled = false;
    // Declared before finish() so every path can clear it. spawn() can throw
    // before the timer exists, and clearTimeout(undefined) is a no-op.
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const finish = (result: ProbeRun | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const abandon = () => {
      // Detach the streams as well as killing the tree: a killed process whose
      // stdio is still piped keeps the event loop alive.
      child.stdout?.destroy();
      child.stderr?.destroy();
      killTree(child);
      child.unref();
      finish(null);
    };
    const onAbort = () => abandon();

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...args], {
        env: { ...process.env, PATH: getEnhancedPath() },
        // A probe runs whenever the settings tab opens; no console may flash.
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own the tree so a status command that spawns a helper cannot outlive
        // the timeout below.
        detached: !isWindows,
      });
    } catch {
      // spawn() throws synchronously for an invalid path or args (EINVAL on
      // Windows), which would reject a promise this function promises never
      // rejects — and the callers attach no .catch.
      finish(null);
      return;
    }

    timer = setTimeout(abandon, timeoutMs);

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', () => finish(null));
    child.on('close', (code) => finish({ stdout, stderr, code }));
  });
}

/**
 * Ask a provider CLI whether it is logged in.
 *
 * Never rejects: a CLI that hangs, crashes or is missing resolves to a state,
 * because this drives a badge and must not be able to break the view.
 */
export async function checkProviderReadiness(
  providerId: ProviderId,
  options: { cliPath?: string; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ReadinessResult> {
  const probe = PROBES[providerId];
  const cliPath = findProviderCliPath(providerId, options.cliPath);
  if (!cliPath) return { state: 'cli-missing' };
  if (!probe) return { state: 'unknown' };

  const [probeCommand, probeArgs] = resolveProbeCommand(cliPath, probe.args);
  const run = await runProbeProcess(probeCommand, probeArgs, {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
  if (!run) return { state: 'unknown' };
  return {
    state: probe.interpret(run.stdout, run.stderr, run.code),
    output: `${run.stdout}${run.stderr}`.trim(),
  };
}

