/**
 * Installing Node.js for a student who has never used a terminal.
 *
 * The wizard used to say "the plugin cannot install Node.js" and send the
 * student to nodejs.org. On macOS that is not true: `brew install node` needs
 * no sudo and no terminal, and brew is findable on the enhanced PATH.
 *
 * What is deliberately NOT automated is installing Homebrew itself. That is a
 * `curl | bash` that asks for sudo, and running it silently out of a note-taking
 * app is not something a student can meaningfully consent to.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { getEnhancedPath } from '../../utils/env';
import { isWindows, killTree } from './processTree';

export type PackageManagerId = 'brew' | 'winget';

export interface PackageManager {
  id: PackageManagerId;
  /** Absolute path to the package manager binary. */
  binPath: string;
  /** Arguments that install Node.js non-interactively. */
  installArgs: readonly string[];
  /** Shown to the student before anything runs. */
  displayCommand: string;
}

/**
 * winget's recipe is written from its documented interface and is NOT verified —
 * no Windows machine was available. It is offered rather than withheld because
 * the failure is visible and recoverable (the command errors in the log and the
 * student can still fall back to nodejs.org), whereas withholding it makes every
 * Windows student do it by hand.
 */
const CANDIDATES: readonly Omit<PackageManager, 'binPath'>[] = isWindows
  ? [{
      id: 'winget',
      installArgs: ['install', '-e', '--id', 'OpenJS.NodeJS.LTS', '--accept-source-agreements', '--accept-package-agreements'],
      displayCommand: 'winget install OpenJS.NodeJS.LTS',
    }]
  : [{
      id: 'brew',
      installArgs: ['install', 'node'],
      displayCommand: 'brew install node',
    }];

function findOnPath(binaryName: string): string | null {
  const names = isWindows ? [`${binaryName}.exe`, `${binaryName}.cmd`] : [binaryName];
  for (const dir of getEnhancedPath().split(isWindows ? ';' : ':')) {
    if (!dir) continue;
    for (const name of names) {
      try {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch { /* unreadable dir */ }
    }
  }
  return null;
}

/** The package manager this machine can install Node.js with, if any. */
export function detectPackageManager(): PackageManager | null {
  for (const candidate of CANDIDATES) {
    const binPath = findOnPath(candidate.id);
    if (binPath) return { ...candidate, binPath };
  }
  return null;
}

/** Where to send a student who has no package manager at all. */
export const NODE_DOWNLOAD_URL = 'https://nodejs.org/en/download';

export interface NodeInstallResult {
  success: boolean;
  error?: string;
}

export interface NodeInstallSession {
  /** Stop the installer and resolve `done` as cancelled. Safe to call twice. */
  cancel(): void;
  done: Promise<NodeInstallResult>;
}

/** A package install can genuinely take minutes; this only bounds a hang. */
const NODE_INSTALL_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Install Node.js with the detected package manager, streaming its output.
 *
 * Returns a session rather than a bare promise so the wizard can stop the
 * install when the student closes it. Without that, closing the modal left
 * brew or winget running with no UI and no way to stop it.
 *
 * Resolves rather than rejects on every failure path — this drives a wizard
 * step and the student needs to see the reason, not a stack trace.
 */
export function startNodeInstall(
  onProgress: (line: string) => void,
  manager: PackageManager | null = detectPackageManager()
): NodeInstallSession {
  if (!manager) {
    return {
      cancel: () => { /* nothing was started */ },
      done: Promise.resolve({ success: false, error: 'Homebrew도 winget도 찾지 못했습니다.' }),
    };
  }

  let settled = false;
  let resolveDone: (result: NodeInstallResult) => void;
  const done = new Promise<NodeInstallResult>((resolve) => { resolveDone = resolve; });
  const finish = (result: NodeInstallResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveDone(result);
  };

  const child = spawn(manager.binPath, [...manager.installArgs], {
    env: { ...process.env, PATH: getEnhancedPath() },
    stdio: ['ignore', 'pipe', 'pipe'],
    // brew drives sub-processes; own the group so cancel really stops the work.
    detached: !isWindows,
  });

  const teardown = () => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    killTree(child);
    child.unref();
  };

  const timer = setTimeout(() => {
    teardown();
    finish({ success: false, error: '설치 시간이 초과됐습니다.' });
  }, NODE_INSTALL_TIMEOUT_MS);

  const errors: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) onProgress(line);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    // brew writes ordinary progress to stderr, so this is shown, not buried.
    if (line) { onProgress(line); errors.push(line); }
  });

  child.on('error', (err: Error) => finish({ success: false, error: err.message }));
  child.on('close', (code) => finish(code === 0
    ? { success: true }
    : { success: false, error: errors.slice(-5).join('\n') || `종료 코드 ${code ?? '?'}` }));

  return {
    cancel() {
      if (settled) return;
      teardown();
      finish({ success: false, error: '설치를 취소했습니다.' });
    },
    done,
  };
}

/** Convenience wrapper for callers that cannot cancel. */
export async function installNode(
  onProgress: (line: string) => void,
  manager: PackageManager | null = detectPackageManager()
): Promise<NodeInstallResult> {
  return startNodeInstall(onProgress, manager).done;
}
