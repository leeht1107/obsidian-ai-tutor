import { spawn } from 'child_process';

import { killTree } from '@/core/setup/processTree';

/**
 * killTree signals a process group via the negative pid. A guard bug here would
 * send SIGKILL to Obsidian's own group, so the invalid-pid cases are pinned.
 */
describe('killTree', () => {
  it('does nothing for a child that never got a pid', () => {
    expect(() => killTree({ pid: undefined } as any)).not.toThrow();
  });

  it('refuses pid 0 and negative pids, which would signal our own group', () => {
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const childKill = jest.fn();

    killTree({ pid: 0, kill: childKill } as any);
    killTree({ pid: -1, kill: childKill } as any);

    expect(kill).not.toHaveBeenCalled();
    expect(childKill).not.toHaveBeenCalled();
    kill.mockRestore();
  });

  it('falls back to killing the child when its group is already gone', () => {
    if (process.platform === 'win32') return;
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    const childKill = jest.fn();

    killTree({ pid: 4242, kill: childKill } as any);

    expect(childKill).toHaveBeenCalledWith('SIGKILL');
    kill.mockRestore();
  });

  it('kills a real detached process group', async () => {
    if (process.platform === 'win32') return;
    const child = spawn('/bin/sh', ['-c', 'sleep 30'], { detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 200));
    const pid = child.pid as number;

    killTree(child);
    await new Promise((r) => setTimeout(r, 300));

    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    expect(alive).toBe(false);
  });
});
