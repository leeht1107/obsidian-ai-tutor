/**
 * ObsidianCode - Environment Utilities
 *
 * Environment variable parsing, model configuration, and PATH enhancement for GUI apps.
 */

import * as fs from 'fs';
import * as path from 'path';

import { parsePathEntries } from './path';

const isWindows = process.platform === 'win32';
const PATH_SEPARATOR = isWindows ? ';' : ':';
const NODE_EXECUTABLE = isWindows ? 'node.exe' : 'node';

function parseNodeVersion(version: string): { major: number; minor: number; patch: number; prerelease?: string } | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] };
}

function compareNodeVersions(a: string, b: string): number {
  const left = parseNodeVersion(a);
  const right = parseNodeVersion(b);
  if (!left || !right) return 0;
  for (const key of ['major', 'minor', 'patch'] as const) {
    const difference = right[key] - left[key];
    if (difference !== 0) return difference;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return -1;
  if (!right.prerelease) return 1;
  return right.prerelease.localeCompare(left.prerelease, undefined, { numeric: true });
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.filter(Boolean))];
}

/**
 * Return NVM Node bin directories without relying on shell startup files.
 * GUI apps often lack NVM_BIN, so resolve its default alias and then scan the
 * installed versions as a bounded fallback.
 */
export function getNvmCandidateDirs(home: string): string[] {
  if (isWindows) return [];
  const candidates: string[] = [];
  if (process.env.NVM_BIN) candidates.push(process.env.NVM_BIN);
  if (!home) return uniquePaths(candidates);

  const nvmDir = path.join(home, '.nvm');
  let alias = '';
  try {
    alias = fs.readFileSync(path.join(nvmDir, 'alias', 'default'), 'utf8').trim();
  } catch { /* NVM is not installed */ }

  // NVM aliases can point directly to a version (v22.14.0) or through a
  // named alias (22 -> v22.14.0, lts/*, etc.). Bound alias resolution.
  for (let depth = 0; alias && depth < 4; depth++) {
    const parsed = parseNodeVersion(alias);
    if (parsed) {
      const version = alias.startsWith('v') ? alias : `v${alias}`;
      candidates.push(path.join(nvmDir, 'versions', 'node', version, 'bin'));
      break;
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(alias) || alias.split('/').some(part => !part || part === '..')) break;
    try {
      alias = fs.readFileSync(path.join(nvmDir, 'alias', ...alias.split('/')), 'utf8').trim();
    } catch { break; }
  }

  try {
    const versionsDir = path.join(nvmDir, 'versions', 'node');
    const versions = fs.readdirSync(versionsDir)
      .filter(version => parseNodeVersion(version) !== null)
      .sort(compareNodeVersions);
    for (const version of versions.slice(0, 3)) {
      candidates.push(path.join(versionsDir, version, 'bin'));
    }
  } catch { /* NVM is not installed or is inaccessible */ }

  return uniquePaths(candidates);
}

/** Return bin directories for fnm's installed Node versions. */
export function getFnmCandidateDirs(home: string): string[] {
  if (isWindows) return [];
  const candidates: string[] = [];
  if (process.env.FNM_MULTISHELL_PATH) candidates.push(process.env.FNM_MULTISHELL_PATH);
  const fnmDirs = uniquePaths([
    process.env.FNM_DIR || '',
    home ? path.join(home, '.local', 'share', 'fnm') : '',
    home ? path.join(home, '.fnm') : '',
  ]);

  for (const fnmDir of fnmDirs) {
    try {
      const versionsDir = path.join(fnmDir, 'node-versions');
      const versions = fs.readdirSync(versionsDir)
        .filter(version => parseNodeVersion(version) !== null)
        .sort(compareNodeVersions);
      for (const version of versions.slice(0, 3)) {
        candidates.push(path.join(versionsDir, version, 'installation', 'bin'));
      }
    } catch { /* fnm is not installed or is inaccessible */ }
  }

  return uniquePaths(candidates);
}

/**
 * Get the user's home directory, handling both Unix and Windows.
 */
function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

/**
 * Get platform-specific extra binary paths for GUI apps.
 * GUI apps like Obsidian have minimal PATH, so we add common locations.
 */
function getExtraBinaryPaths(): string[] {
  const home = getHomeDir();

  if (isWindows) {
    const paths: string[] = [];
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const programData = process.env.ProgramData || 'C:\\ProgramData';

    // Node.js / npm locations
    if (appData) {
      paths.push(path.join(appData, 'npm'));
    }
    if (localAppData) {
      paths.push(path.join(localAppData, 'Programs', 'nodejs'));
      paths.push(path.join(localAppData, 'Programs', 'node'));
    }

    // Common program locations (official Node.js installer)
    paths.push(path.join(programFiles, 'nodejs'));
    paths.push(path.join(programFilesX86, 'nodejs'));

    // nvm-windows: active Node.js is usually under %NVM_SYMLINK%
    const nvmSymlink = process.env.NVM_SYMLINK;
    if (nvmSymlink) {
      paths.push(nvmSymlink);
    }

    // nvm-windows: stores Node.js versions in %NVM_HOME% or %APPDATA%\nvm
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome) {
      paths.push(nvmHome);
    } else if (appData) {
      paths.push(path.join(appData, 'nvm'));
    }

    // volta: installs to %VOLTA_HOME%\bin or %USERPROFILE%\.volta\bin
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path.join(voltaHome, 'bin'));
    } else if (home) {
      paths.push(path.join(home, '.volta', 'bin'));
    }

    // fnm (Fast Node Manager): %FNM_MULTISHELL_PATH% is the active Node.js bin
    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) {
      paths.push(fnmMultishell);
    }

    // fnm (Fast Node Manager): %FNM_DIR% or %LOCALAPPDATA%\fnm
    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    } else if (localAppData) {
      paths.push(path.join(localAppData, 'fnm'));
    }

    // Chocolatey: %ChocolateyInstall%\bin or C:\ProgramData\chocolatey\bin
    const chocolateyInstall = process.env.ChocolateyInstall;
    if (chocolateyInstall) {
      paths.push(path.join(chocolateyInstall, 'bin'));
    } else {
      paths.push(path.join(programData, 'chocolatey', 'bin'));
    }

    // scoop: %SCOOP%\shims or %USERPROFILE%\scoop\shims
    const scoopDir = process.env.SCOOP;
    if (scoopDir) {
      paths.push(path.join(scoopDir, 'shims'));
      paths.push(path.join(scoopDir, 'apps', 'nodejs', 'current', 'bin'));
      paths.push(path.join(scoopDir, 'apps', 'nodejs', 'current'));
    } else if (home) {
      paths.push(path.join(home, 'scoop', 'shims'));
      paths.push(path.join(home, 'scoop', 'apps', 'nodejs', 'current', 'bin'));
      paths.push(path.join(home, 'scoop', 'apps', 'nodejs', 'current'));
    }

    // Docker
    paths.push(path.join(programFiles, 'Docker', 'Docker', 'resources', 'bin'));

    // User bin (if exists)
    if (home) {
      paths.push(path.join(home, '.local', 'bin'));
    }

    return paths;
  } else {
    // Unix paths
    const paths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',  // macOS ARM Homebrew
      '/usr/bin',
      '/bin',
    ];

    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      paths.push(path.join(voltaHome, 'bin'));
    }

    const asdfRoot = process.env.ASDF_DATA_DIR || process.env.ASDF_DIR;
    if (asdfRoot) {
      paths.push(path.join(asdfRoot, 'shims'));
      paths.push(path.join(asdfRoot, 'bin'));
    }

    const fnmMultishell = process.env.FNM_MULTISHELL_PATH;
    if (fnmMultishell) {
      paths.push(fnmMultishell);
    }

    const fnmDir = process.env.FNM_DIR;
    if (fnmDir) {
      paths.push(fnmDir);
    }

    if (home) {
      paths.push(path.join(home, '.local', 'bin'));
      paths.push(path.join(home, '.docker', 'bin'));
      paths.push(path.join(home, '.volta', 'bin'));
      paths.push(path.join(home, '.asdf', 'shims'));
      paths.push(path.join(home, '.asdf', 'bin'));
      paths.push(path.join(home, '.npm-global', 'bin'));
      paths.push(path.join(home, 'bin'));
      paths.push(path.join(home, '.fnm'));
      paths.push(...getFnmCandidateDirs(home));
      paths.push(...getNvmCandidateDirs(home));
    }

    return paths;
  }
}

/**
 * Searches for the Node.js executable in common installation locations.
 * Returns the directory containing node, or null if not found.
 */
export function findNodeDirectory(): string | null {
  const searchPaths = getExtraBinaryPaths();

  // Also check current PATH
  const currentPath = process.env.PATH || '';
  const pathDirs = parsePathEntries(currentPath);

  // Search in extra paths first (more likely to have node), then current PATH
  const allPaths = [...searchPaths, ...pathDirs];

  for (const dir of allPaths) {
    if (!dir) continue;
    try {
      const nodePath = path.join(dir, NODE_EXECUTABLE);
      if (fs.existsSync(nodePath)) {
        const stat = fs.statSync(nodePath);
        if (stat.isFile()) {
          return dir;
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return null;
}

/**
 * Checks if a CLI path requires Node.js to execute (i.e., is a .js file).
 */
export function cliPathRequiresNode(cliPath: string): boolean {
  const jsExtensions = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];
  const lower = cliPath.toLowerCase();
  if (jsExtensions.some(ext => lower.endsWith(ext))) {
    return true;
  }

  try {
    if (!fs.existsSync(cliPath)) {
      return false;
    }

    const stat = fs.statSync(cliPath);
    if (!stat.isFile()) {
      return false;
    }

    let fd: number | null = null;
    try {
      fd = fs.openSync(cliPath, 'r');
      const buffer = Buffer.alloc(200);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const header = buffer.slice(0, bytesRead).toString('utf8');
      return header.startsWith('#!') && header.toLowerCase().includes('node');
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close errors
        }
      }
    }
  } catch {
    return false;
  }
}

/**
 * Returns an enhanced PATH that includes common binary locations.
 * GUI apps like Obsidian have minimal PATH, so we need to add standard locations
 * where binaries like node, python, etc. are typically installed.
 *
 * @param additionalPaths - Optional additional PATH entries to include (from user config).
 *                          These take priority and are prepended.
 * @param cliPath - Optional CLI path. If provided and its directory contains node,
 *                  that directory is added to PATH. This handles nvm, fnm, volta, etc.
 *                  where npm globals are installed alongside node.
 */
export function getEnhancedPath(additionalPaths?: string, cliPath?: string): string {
  const extraPaths = getExtraBinaryPaths().filter(p => p); // Filter out empty
  const currentPath = process.env.PATH || '';

  // Build path segments: additional (user config) > CLI dir (if has node) > node dir (fallback) > extra paths > current PATH
  const segments: string[] = [];

  // Add user-specified paths first (highest priority)
  if (additionalPaths) {
    segments.push(...parsePathEntries(additionalPaths));
  }

  // If CLI path is provided, check if its directory contains node executable.
  // This handles nvm, fnm, volta, asdf, etc. where npm globals are installed
  // in the same bin directory as node. Works on both Windows and Unix.
  let cliDirHasNode = false;
  if (cliPath) {
    try {
      const cliDir = path.dirname(cliPath);
      const nodeInCliDir = path.join(cliDir, NODE_EXECUTABLE);
      if (fs.existsSync(nodeInCliDir)) {
        const stat = fs.statSync(nodeInCliDir);
        if (stat.isFile()) {
          segments.push(cliDir);
          cliDirHasNode = true;
        }
      }
    } catch {
      // Ignore errors checking CLI directory
    }
  }

  // Fallback: If CLI is a .js file and we didn't find node in CLI dir,
  // search common locations for Node.js
  if (cliPath && cliPathRequiresNode(cliPath) && !cliDirHasNode) {
    const nodeDir = findNodeDirectory();
    if (nodeDir) {
      segments.push(nodeDir);
    }
  }

  // Add our extra paths
  segments.push(...extraPaths);

  // Add current PATH
  if (currentPath) {
    segments.push(...parsePathEntries(currentPath));
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique = segments.filter(p => {
    const normalized = isWindows ? p.toLowerCase() : p;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  return unique.join(PATH_SEPARATOR);
}

/** Parses KEY=VALUE environment variables from text. Supports comments (#) and empty lines. */
export function parseEnvironmentVariables(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Handle both Unix (LF) and Windows (CRLF) line endings
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();
      // Strip surrounding quotes (single or double)
      if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) {
        const tokenKeys = new Set(['GITHUB_TOKEN', 'GH_TOKEN', 'COPILOT_GITHUB_TOKEN']);
        const normalizedPlaceholder = value.toLowerCase();
        if (tokenKeys.has(key) &&
          (normalizedPlaceholder === 'your_api_key_here' ||
            normalizedPlaceholder === 'your-key' ||
            normalizedPlaceholder.includes('your_api_key') ||
            normalizedPlaceholder.includes('your_github_token') ||
            normalizedPlaceholder.includes('your_copilot_token'))) {
          continue;
        }
        result[key] = value;
      }
    }
  }
  return result;
}
