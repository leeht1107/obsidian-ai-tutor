/**
 * Killing a spawned CLI and everything it started.
 *
 * A login or install CLI spawns helpers, and `child.kill()` signals only the
 * direct pid — the helpers keep running after a cancel, a timeout, or the modal
 * closing. On POSIX the children here are spawned `detached` so they lead their
 * own process group, which is signalled as a unit via the negative pid. Windows
 * has no process groups to signal, so it needs `taskkill /T`.
 */

import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';

export const isWindows = process.platform === 'win32';

/** Signal the child's whole process tree; never throws. */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): void {
  const { pid } = child;
  // A child that failed to spawn has no pid; pid 0 and negatives would signal
  // this process's own group, which would kill Obsidian.
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return;

  if (isWindows) {
    try {
      // /T takes the children with it, /F does not ask.
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        .on('error', () => { /* taskkill missing; the fallback below still runs */ });
    } catch { /* fall through to the direct kill */ }
  } else {
    try {
      // Negative pid targets the group the detached child leads.
      process.kill(-pid, signal);
      return;
    } catch {
      // Group already gone, or the child was not detached after all; fall
      // through rather than leaving it alive.
    }
  }

  try {
    child.kill(signal);
  } catch { /* already exited */ }
}
