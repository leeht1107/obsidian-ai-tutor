/**
 * ErrorLog — one file a student can hand over when something breaks.
 *
 * The failures that matter most here are the ones nobody in this repository can
 * reproduce: a Windows install whose CLI shim resolves to nothing, a provider
 * that exits without answering. The student sees a Korean sentence and moves on,
 * and the evidence disappears with the session.
 *
 * So every error the student is shown is also written here, in the vault beside
 * their settings, one JSON object per line. It is meant to be read by a person
 * later, not by this plugin.
 *
 * Two rules this file exists to keep:
 * - Nothing here may throw. A logger that breaks a request is worse than no log.
 * - Nothing secret reaches it. Messages arrive already redacted, and paths are
 *   written with the home directory masked so a filename does not carry a
 *   student's real name to whoever reads the log.
 */
import type { VaultFileAdapter } from './VaultFileAdapter';

export const ERROR_LOG_PATH = '.copilot/logs/errors.jsonl';

/** Keep the tail. An old failure is rarely what the student is asking about. */
const MAX_ENTRIES = 300;

export interface ErrorLogEntry {
  /** ISO timestamp. */
  at: string;
  /** Which CLI, or 'plugin' for a failure before one was chosen. */
  provider: string;
  /** Where in the request it broke — the first thing a reader needs. */
  stage: 'resolve' | 'launch' | 'exit' | 'empty-answer';
  /** Already redacted by the caller. */
  message: string;
  platform: string;
  pluginVersion: string;
  exitCode?: number | null;
  signal?: string | null;
  /** Home directory masked. On Windows this is usually the whole story. */
  cliPath?: string;
  /** What the resolver decided to actually spawn, if it got that far. */
  resolved?: string;
}

/**
 * Replace the user's home directory with `~`.
 *
 * A Windows npm path is `C:\Users\<real name>\AppData\...`, and that path is
 * exactly the diagnostic detail worth keeping — so mask the name rather than
 * drop the path.
 */
export function maskHome(value: string | undefined, home: string): string | undefined {
  if (!value) return value;
  if (!home) return value;
  const normalized = value.replace(/\//g, '\\');
  const normalizedHome = home.replace(/\//g, '\\');
  return normalized.toLowerCase().startsWith(normalizedHome.toLowerCase())
    ? '~' + value.slice(home.length)
    : value;
}

/** Append one entry, trimming the file to the most recent MAX_ENTRIES. */
export async function appendErrorLog(
  adapter: VaultFileAdapter,
  entry: ErrorLogEntry
): Promise<void> {
  try {
    const line = JSON.stringify(entry);
    const existing = (await adapter.exists(ERROR_LOG_PATH))
      ? await adapter.read(ERROR_LOG_PATH)
      : '';
    const lines = existing.split('\n').filter((l) => l.trim().length > 0);
    lines.push(line);
    await adapter.write(
      ERROR_LOG_PATH,
      lines.slice(-MAX_ENTRIES).join('\n') + '\n'
    );
  } catch (error) {
    console.warn('[ObsidianCopilot] Failed to write the error log:', error);
  }
}

/** The most recent entries, newest last, for the settings tab's copy button. */
export async function readRecentErrors(
  adapter: VaultFileAdapter,
  limit = 50
): Promise<ErrorLogEntry[]> {
  try {
    if (!(await adapter.exists(ERROR_LOG_PATH))) return [];
    const raw = await adapter.read(ERROR_LOG_PATH);
    return raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l) as ErrorLogEntry; } catch { return null; }
      })
      .filter((e): e is ErrorLogEntry => e !== null);
  } catch {
    return [];
  }
}

/** Plain text a student can paste into a message, without opening a terminal. */
export function formatErrorsForReport(entries: ErrorLogEntry[]): string {
  if (entries.length === 0) return '기록된 오류가 없습니다.';
  return entries
    .map((e) => {
      const head = `[${e.at}] ${e.provider} / ${e.stage}`;
      const where = [e.cliPath && `cli: ${e.cliPath}`, e.resolved && `run: ${e.resolved}`]
        .filter(Boolean)
        .join(' | ');
      const how = [
        e.exitCode !== undefined && e.exitCode !== null ? `exit ${e.exitCode}` : '',
        e.signal ? `signal ${e.signal}` : '',
        `${e.platform} / plugin ${e.pluginVersion}`,
      ].filter(Boolean).join(' | ');
      return [head, where, how, e.message].filter(Boolean).join('\n');
    })
    .join('\n\n');
}
