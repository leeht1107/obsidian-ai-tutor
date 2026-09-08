/**
 * ErrorLog — one file a student can hand over when something breaks.
 *
 * The failures that matter most here are the ones nobody in this repository can
 * reproduce: a Windows install whose CLI shim resolves to nothing, a provider
 * that exits without answering. The student sees a Korean sentence and moves on,
 * and the evidence disappears with the session.
 *
 * So every error the student is shown is also written here, one JSON object per
 * line. It is meant to be read by a person later, not by this plugin.
 *
 * It lives in `.ai-tutor/logs/`, beside the settings and slash commands the
 * student already opens. That is a deliberate reversal: the log used to sit in
 * the plugin's own folder under `.obsidian/plugins/`, which is tidier but
 * unreachable for the one person who has to send it. On Windows that folder is
 * hidden, and a student who cannot find the file sends nothing at all. A log
 * nobody can hand over is not a log.
 *
 * Putting it in the vault does not make it trusted input. Nothing in this
 * plugin reads it back as configuration — the only reader is the settings tab's
 * copy button, which formats it for a human.
 *
 * Two rules this file exists to keep:
 * - Nothing here may throw. A logger that breaks a request is worse than no log.
 * - Nothing secret reaches it. Messages arrive already redacted, and paths are
 *   written with the home directory masked so a filename does not carry a
 *   student's real name to whoever reads the log.
 */
import type { VaultFileAdapter } from './VaultFileAdapter';

/**
 * Vault-relative path to the log.
 *
 * One fixed path on every platform, so the instruction to a student is the same
 * sentence on macOS and Windows: open `.ai-tutor/logs/errors.jsonl` in your
 * vault. `VaultFileAdapter.write` creates the folder on first use.
 */
export const ERROR_LOG_PATH = '.ai-tutor/logs/errors.jsonl';

/** Keep the tail. An old failure is rarely what the student is asking about. */
const MAX_ENTRIES = 300;

export interface ErrorLogEntry {
  /** ISO timestamp. */
  at: string;
  /** Which CLI, or 'plugin' for a failure before one was chosen. */
  provider: string;
  /** Where in the request it broke — the first thing a reader needs. */
  stage: 'resolve' | 'launch' | 'exit' | 'empty-answer' | 'install' | 'login' | 'internal';
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
 *
 * The match has to stop at a path boundary. `/Users/markAlt` merely starts with
 * the same text as `/Users/mark`, and a bare `startsWith` turned it into
 * `~Alt/...`: a path nobody can act on, which also left half of the very
 * directory name it was masking on display.
 */
export function maskHome(value: string | undefined, home: string): string | undefined {
  if (!value) return value;
  if (!home) return value;
  const normalized = value.replace(/\//g, '\\');
  const normalizedHome = home.replace(/\//g, '\\');
  if (!normalized.toLowerCase().startsWith(normalizedHome.toLowerCase())) return value;
  const next = normalized.charAt(normalizedHome.length);
  if (next !== '' && next !== '\\') return value;
  return '~' + value.slice(home.length);
}

/**
 * Replace the home directory wherever it appears inside a message.
 *
 * `maskHome` only handles a value that *is* a path. A message is prose with
 * paths in it: a failed spawn reports its working directory, and npm prints
 * `C:\\Users\\<real name>\\...` on the way out. Redaction does not catch these —
 * it removes configured credentials — so without this the student's account
 * name travels to whoever reads the log.
 *
 * The lookahead is the same boundary rule as `maskHome`, for the same reason:
 * `/Users/markAlt` is somebody else's directory.
 */
export function maskHomeInText(text: string, home: string): string {
  if (!text || !home) return text;
  // Windows output that has already been through a JSON encoder arrives with its
  // separators doubled, and matches neither of the plain forms.
  const slashed = home.replace(/\\/g, '/');
  const variants = new Set([home, home.replace(/\//g, '\\'), slashed, slashed.replace(/\//g, '\\\\')]);
  let out = text;
  for (const variant of variants) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`${escaped}(?![A-Za-z0-9._-])`, 'gi'), '~');
  }
  return out;
}

/**
 * Remove credential-shaped text nobody configured.
 *
 * The caller's own redaction can only remove what this plugin knows: the
 * student's configured token and their environment variables. Install failures
 * carry somebody else's text — a registry URL with a token in its query, an
 * npmrc `_authToken` line, a `Bearer` header echoed back — and that text is
 * written to a file the student mails to a stranger.
 *
 * Narrow on purpose. The last few lines of npm output are the only place the
 * real cause of a failed install appears, so this removes the value beside a
 * credential-shaped key and leaves the sentence around it intact.
 */
export function scrubCredentialPatterns(text: string): string {
  if (!text) return text;
  return text
    // scheme://user:password@host
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    // An Authorization header, taken to the end of its line. Everything after the
    // colon is the credential, and it is not reliably one whitespace-delimited
    // token: Node prints the value quoted, so a `\S+` rule stops at the quote and
    // leaves the blob behind. This also has to run before the generic key rule
    // below, which would otherwise match the word `Authorization` and replace the
    // scheme alone.
    .replace(/\b(authorization)(\s*[=:]\s*).*/gi, '$1$2[redacted]')
    // A bearer token anywhere else.
    .replace(/\b(bearer\s+)\S+/gi, '$1[redacted]')
    // token=..., _authToken=..., api_key: ..., password ...
    .replace(/\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|auth)[\w-]*)(\s*[=:]\s*)\S+/gi, '$1$2[redacted]')
    // Vendor-prefixed keys are recognisable on their own.
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

/**
 * Appends run one at a time.
 *
 * Same read-modify-write hazard `StorageService.updateState` documents: one
 * CopilotBridgeService instance is shared by chat, title generation, inline edit
 * and instruction refine, and `logError` starts the append without awaiting it.
 * Two failures in the same tick both read the file as it was before either
 * wrote, and the entry that saved first is erased by the one that saved last —
 * silently, in the one file a student was going to hand over.
 */
let appendQueue: Promise<void> = Promise.resolve();

/** Append one entry, trimming the file to the most recent MAX_ENTRIES. */
export function appendErrorLog(
  adapter: VaultFileAdapter,
  logPath: string,
  entry: ErrorLogEntry
): Promise<void> {
  const write = appendQueue.then(() => writeOneEntry(adapter, logPath, entry));
  // A rejected write must not wedge every later one behind it.
  appendQueue = write.catch(() => undefined);
  return write;
}

async function writeOneEntry(
  adapter: VaultFileAdapter,
  logPath: string,
  entry: ErrorLogEntry
): Promise<void> {
  try {
    const line = JSON.stringify(entry);
    const existing = (await adapter.exists(logPath))
      ? await adapter.read(logPath)
      : '';
    const lines = existing.split('\n').filter((l) => l.trim().length > 0);
    lines.push(line);
    await adapter.write(logPath, lines.slice(-MAX_ENTRIES).join('\n') + '\n');
  } catch (error) {
    console.warn('[ObsidianCopilot] Failed to write the error log:', error);
  }
}

/**
 * Record a failure the student was shown, from anywhere in the plugin.
 *
 * The chat path and the setup wizard both land here, so a student who never got
 * as far as sending a message still hands over a file with their install failure
 * in it. Same contract as everything else in this file: swallow every error, and
 * take the message already redacted — this does not scrub.
 */
export function recordError(
  adapter: VaultFileAdapter | undefined,
  entry: Omit<ErrorLogEntry, 'at' | 'platform' | 'pluginVersion'>,
  meta: { home: string; pluginVersion: string }
): void {
  try {
    if (!adapter) return;
    void appendErrorLog(adapter, ERROR_LOG_PATH, {
      ...entry,
      // The message is masked and scrubbed here, at the one boundary every
      // caller passes through, rather than at each call site that could forget.
      message: scrubCredentialPatterns(maskHomeInText(entry.message, meta.home)),
      cliPath: maskHome(entry.cliPath, meta.home),
      resolved: maskHome(entry.resolved, meta.home),
      at: new Date().toISOString(),
      platform: `${process.platform} ${process.arch}`,
      pluginVersion: meta.pluginVersion,
    });
  } catch { /* never break a request, or a wizard, to write a log line */ }
}

/** The most recent entries, newest last, for the settings tab's copy button. */
export async function readRecentErrors(
  adapter: VaultFileAdapter,
  logPath: string,
  limit = 50
): Promise<ErrorLogEntry[]> {
  try {
    if (!(await adapter.exists(logPath))) return [];
    const raw = await adapter.read(logPath);
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
