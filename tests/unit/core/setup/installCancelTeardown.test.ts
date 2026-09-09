/**
 * A cancelled install must not report itself finished while its process tree is
 * still alive.
 *
 * `killTree` only signals: on POSIX it sends SIGKILL to the group and returns,
 * and on Windows it *spawns* `taskkill /T /F` without waiting for it. Resolving
 * `done` at that moment tells the caller it is safe to start the next
 * package-manager run, which is how two installs end up writing one global
 * prefix. The wizard's queue starts the next install off this promise, so the
 * happens-before edge has to live here.
 */
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { startNodeInstall } from '@/core/setup/nodeInstall';

const skipOnWindows = process.platform === 'win32';

describe('cancelling an install waits for the process to actually exit', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-teardown-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function slowManager(name: string) {
    const binPath = path.join(dir, name);
    fs.writeFileSync(binPath, '#!/bin/sh\nsleep 60\n');
    fs.chmodSync(binPath, 0o755);
    return { id: 'brew' as const, binPath, installArgs: ['install', 'node'], displayCommand: 'brew install node' };
  }

  it('resolves only once the killed tree is gone', async () => {
    if (skipOnWindows) return;
    const session = startNodeInstall(() => { /* ignore */ }, slowManager('brew-teardown'));
    // Give the child a moment to exist at all, so the assertion below is about
    // the teardown rather than about a process that never started.
    await new Promise((resolve) => setTimeout(resolve, 50));

    session.cancel();
    const result = await session.done;

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('취소');
    // Nothing from that install survives the promise resolving. `pgrep -f`
    // rather than the pid, because the pid is reaped and could be reused.
    const survivors = await new Promise<string>((resolve) => {
      const probe = spawn('pgrep', ['-f', 'brew-teardown']);
      let out = '';
      probe.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      probe.on('close', () => resolve(out.trim()));
      probe.on('error', () => resolve(''));
    });
    expect(survivors).toBe('');
  });

  it('says so instead of parking the caller when no exit is reported in time', async () => {
    if (skipOnWindows) return;
    // The grace timer is what keeps a cancel from hanging the wizard forever,
    // but "the timer fired" is not "the process stopped" — the result has to
    // carry that difference, because the caller uses it to decide whether
    // starting the next package manager is safe.
    jest.useFakeTimers();
    try {
      const session = startNodeInstall(() => { /* ignore */ }, slowManager('brew-grace'));
      session.cancel();
      // The child's close event needs an I/O turn, so advancing here reaches the
      // grace timer first — which is the situation this flag exists for.
      jest.advanceTimersByTime(3000);
      await expect(session.done).resolves.toMatchObject({
        success: false,
        teardownUnconfirmed: true,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a confirmed stop without the unconfirmed flag', async () => {
    if (skipOnWindows) return;
    const session = startNodeInstall(() => { /* ignore */ }, slowManager('brew-confirmed'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    session.cancel();
    const result = await session.done;

    expect(result.teardownUnconfirmed).toBeUndefined();
  });

  it('reports nothing to wait for when no package manager was ever spawned', async () => {
    const session = startNodeInstall(() => { /* ignore */ }, null);
    session.cancel();

    await expect(session.done).resolves.toMatchObject({ success: false });
  });
});
