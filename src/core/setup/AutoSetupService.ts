/**
 * AutoSetupService — detects missing GitHub Copilot CLI and handles auto-install.
 *
 * Runs entirely in-process (no shell sources), so it works in GUI environments
 * (Obsidian, Electron) where .zshrc / .bashrc are never sourced.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { findCopilotCLIPath } from '../../utils/copilotCli';
import { getEnhancedPath } from '../../utils/env';
import { findProviderCliPath, getProviderDescriptor, type ProviderId } from '../providers/providerRegistry';
import { killTree } from './processTree';

const isWindows = process.platform === 'win32';

/** Prevent showing the wizard more than once per Obsidian session. */
let shownThisSession = false;

export function markShownThisSession(): void {
  shownThisSession = true;
}

export function hasShownThisSession(): boolean {
  return shownThisSession;
}

/**
 * Find the npm binary using the same enhanced PATH that getEnhancedPath() builds.
 * This covers Homebrew, NVM, fnm, Volta, nvm-windows, Scoop, etc.
 */
export function findNpmPath(): string | null {
  const npmNames = isWindows ? ['npm.cmd'] : ['npm'];

  // getEnhancedPath() already includes all common Node.js bin dirs
  const dirs = getEnhancedPath().split(isWindows ? ';' : ':');

  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of npmNames) {
      try {
        const p = path.join(dir, name);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
      } catch { /* inaccessible dir */ }
    }
  }

  return null;
}

export interface SetupStatus {
  /** True if the copilot CLI binary is found and usable. */
  cliFound: boolean;
  /** True if npm is available for auto-install. */
  npmFound: boolean;
}

export function checkSetupStatus(): SetupStatus {
  return {
    cliFound: findCopilotCLIPath() !== null,
    npmFound: findNpmPath() !== null,
  };
}

export function checkProviderSetupStatus(providerId: ProviderId): SetupStatus & { status: string } {
  const descriptor = getProviderDescriptor(providerId);
  return { cliFound: findProviderCliPath(providerId) !== null, npmFound: findNpmPath() !== null, status: descriptor.status };
}

export interface InstallResult {
  success: boolean;
  /** Path to the CLI binary if installation succeeded. */
  cliPath?: string;
  /** Human-readable error if installation failed. */
  error?: string;
}

/**
 * Run `npm install -g @github/copilot` in the background.
 * Calls onProgress with stdout lines so the UI can show live output.
 */
export async function installCopilotCLI(
  onProgress: (msg: string) => void
): Promise<InstallResult> {
  const npmPath = findNpmPath();
  if (!npmPath) {
    return { success: false, error: 'npm을 찾을 수 없습니다' };
  }

  return new Promise<InstallResult>((resolve) => {
    const proc = spawn(npmPath, ['install', '-g', '@github/copilot'], {
      env: { ...process.env, PATH: getEnhancedPath() },
      // shell:true needed on Windows for .cmd shim execution
      shell: isWindows,
    });

    proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) onProgress(line);
    });

    const stderrLines: string[] = [];
    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) stderrLines.push(line);
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ success: true, cliPath: findCopilotCLIPath() ?? undefined });
      } else {
        resolve({
          success: false,
          error: stderrLines.join('\n') || `npm exited with code ${code ?? '?'}`,
        });
      }
    });

    proc.on('error', (err: Error) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/** A global npm install is slow but not hours-long; this only bounds a hang. */
const CLI_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

export interface InstallSession {
  /** Stop the installer and resolve `done` as cancelled. Safe to call twice. */
  cancel(): void;
  done: Promise<InstallResult>;
}

/**
 * Cancellable form of {@link installProviderCLI}.
 *
 * The wizard needs this because closing it mid-install otherwise leaves a global
 * npm install running with no window and no way to stop it.
 */
export function startProviderInstall(providerId: ProviderId, onProgress: (msg: string) => void): InstallSession {
  const descriptor = getProviderDescriptor(providerId);
  const packageName = providerId === 'copilot'
    ? '@github/copilot'
    : descriptor.installCommand?.split(' ').slice(3).join(' ');
  const npmPath = findNpmPath();

  if (!packageName || !npmPath) {
    const error = !packageName
      ? '이 provider는 공식 package-manager 설치 명령이 없어 수동 설치가 필요합니다.'
      : 'npm을 찾을 수 없습니다.';
    return { cancel: () => { /* nothing started */ }, done: Promise.resolve({ success: false, error }) };
  }

  let settled = false;
  let resolveDone: (result: InstallResult) => void;
  const done = new Promise<InstallResult>((resolve) => { resolveDone = resolve; });
  const finish = (result: InstallResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveDone(result);
  };

  const child = spawn(npmPath, ['install', '-g', packageName], {
    env: { ...process.env, PATH: getEnhancedPath() },
    // shell:true is needed on Windows for the .cmd shim, and rules out detaching.
    shell: isWindows,
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
  }, CLI_INSTALL_TIMEOUT_MS);

  child.stdout?.on('data', (data: Buffer) => { const line = data.toString().trim(); if (line) onProgress(line); });
  const errors: string[] = [];
  child.stderr?.on('data', (data: Buffer) => { const line = data.toString().trim(); if (line) errors.push(line); });

  child.on('error', (error: Error) => finish({ success: false, error: error.message }));
  child.on('close', (code: number | null) => finish(code === 0
    ? { success: true, cliPath: findProviderCliPath(providerId) ?? undefined }
    : { success: false, error: errors.join('\n') || `npm exited with code ${code ?? '?'}` }));

  return {
    cancel() {
      if (settled) return;
      teardown();
      finish({ success: false, error: '설치를 취소했습니다.' });
    },
    done,
  };
}

/** Installs only a provider with a verified npm recipe; script-only providers stay manual. */
export async function installProviderCLI(providerId: ProviderId, onProgress: (msg: string) => void): Promise<InstallResult> {
  return startProviderInstall(providerId, onProgress).done;
}
