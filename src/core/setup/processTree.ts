/**
 * Killing a spawned CLI and everything it started.
 *
 * A login or install CLI spawns helpers, and `child.kill()` signals only the
 * direct pid — the helpers keep running after a cancel, a timeout, or the modal
 * closing. Children here are spawned `detached` on POSIX so they lead their own
 * process group, which can be signalled as a unit via the negative pid.
 */

import type { ChildProcess } from 'child_process';

export const isWindows = process.platform === 'win32';

/** Signal the child's whole process group; never throws. */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): void {
  const { pid } = child;
  if (pid === undefined) return;

  if (!isWindows) {
    try {
      // Negative pid targets the group the detached child leads.
      process.kill(-pid, signal);
      return;
    } catch {
      // The group is already gone, or the child was not detached after all;
      // fall through to the single-process kill rather than leaving it alive.
    }
  }

  try {
    child.kill(signal);
  } catch { /* already exited */ }
}
