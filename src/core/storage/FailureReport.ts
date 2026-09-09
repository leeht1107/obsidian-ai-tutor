/**
 * FailureReport — the one way a blocking failure reaches the student.
 *
 * `ErrorLog` can write an entry from anywhere, and release 0.1.15 used it to
 * wire seven failure points by hand. The audit that followed found roughly
 * thirteen more still silent, including the one the whole feature exists for: a
 * Windows machine with neither Node.js nor a package manager, where the setup
 * wizard shows a "install it yourself" screen and records nothing at all. That
 * is not a list that was written carelessly; it is what hand-enumeration costs
 * every time somebody adds a failure path.
 *
 * So the notification and the log entry are produced by the same call. A new
 * failure point can still be added without logging — nothing here is enforced by
 * the compiler — but it now takes writing `new Notice(...)` in a file whose
 * neighbours all call this instead, which is the cheapest guard available
 * without changing how failures are delivered.
 *
 * The streaming chat paths deliberately do not use this. Their failure reaches
 * the student as a yielded `error` chunk inside an async generator, not as a
 * Notice, and reshaping them to fit a Notice-shaped seam would mean changing
 * control flow and chunk ordering in the one place that must not change. Those
 * three call `recordError` directly, next to the chunk they push.
 *
 * Two rules, inherited from `ErrorLog` and extended by one:
 * - Nothing here may throw. The caller is already handling a failure.
 * - The student sees the sentence even when the logging fails.
 * - A cancellation is never reported here. Pressing 중지 or choosing "I'll
 *   install it myself" reaches the same code path as a real failure, and logging
 *   it would destroy the only thing an empty log currently means: that the
 *   student was never shown a failure.
 */
import { Notice } from 'obsidian';
import * as os from 'os';

import { type ErrorLogEntry, recordError } from './ErrorLog';
import type { VaultFileAdapter } from './VaultFileAdapter';

/**
 * What the seam needs from the plugin, and nothing more.
 *
 * Structural rather than the plugin type itself: this file sits under
 * `core/storage`, and the installer and settings modules that call it are handed
 * an `App` rather than the plugin. Every field is optional because startup is
 * exactly when these failures happen — `storage` may not exist yet when
 * `onload` reports that it could not load the settings.
 */
export interface FailureReportHost {
  storage?: { getAdapter?: () => VaultFileAdapter | undefined } | null;
  manifest?: { version?: string } | null;
  agentService?: { redactForLog?: (text: string) => string } | null;
}

export interface BlockingFailure {
  /** The Korean sentence the student sees. Written here, so it is safe to log. */
  notice: string;
  /** Where in the request it broke. */
  stage: ErrorLogEntry['stage'];
  /** Which CLI was involved; omitted when the failure is the plugin's own. */
  provider?: string;
  /**
   * Diagnostic text for the log only — an exception message, npm's last lines.
   * Third-party text, so it is redacted before it is written and dropped
   * entirely if there is nothing available to redact it with.
   */
  detail?: string;
  cliPath?: string;
  resolved?: string;
  exitCode?: number | null;
  /** Notice lifetime in ms; 0 keeps it up until the student dismisses it. */
  durationMs?: number;
}

/**
 * Show a failure the student is blocked by, and record it.
 *
 * Call this only when the student is actually shown something. A failure with no
 * visible surface — an empty dropdown, a background probe nobody sees — must not
 * come through here, for the same reason a cancellation must not: the value of
 * this file is that an empty log means nothing went wrong in front of them.
 */
export function reportBlockingFailure(host: FailureReportHost, failure: BlockingFailure): void {
  // The notice first. If anything below is broken, the student still gets the
  // sentence about their own problem; the log is for whoever reads it later.
  try {
    if (failure.durationMs === undefined) new Notice(failure.notice);
    else new Notice(failure.notice, failure.durationMs);
  } catch { /* a UI that refuses a notice must not also lose the log entry */ }

  try {
    // Inside the guard, including the arguments: they are evaluated before
    // `recordError` is entered, and `getAdapter()` on a vault that is not ready
    // throws. A wizard that crashes while recording an install failure is worse
    // than one that records nothing.
    const redact = host.agentService?.redactForLog?.bind(host.agentService);
    // `notice` is this plugin's own literal text and carries nothing to redact.
    // `detail` is somebody else's output; with no redactor to ask, drop it and
    // keep the entry, rather than lose the evidence that the student was blocked.
    const detail = failure.detail && redact ? redact(failure.detail) : '';
    recordError(
      host.storage?.getAdapter?.(),
      {
        provider: failure.provider ?? 'plugin',
        stage: failure.stage,
        message: detail ? `${failure.notice}\n${detail}` : failure.notice,
        cliPath: failure.cliPath,
        resolved: failure.resolved,
        exitCode: failure.exitCode,
      },
      { home: os.homedir(), pluginVersion: host.manifest?.version ?? 'unknown' }
    );
  } catch { /* never break the caller to write a log line */ }
}
