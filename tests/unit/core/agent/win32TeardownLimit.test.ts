import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/**
 * KNOWN LIMITATION, characterization only — not a correctness contract.
 *
 * `killTree` reaps POSIX descendants with `process.kill(-pid)`, and a process
 * group outlives its leader, so the negative-pid signal still reaches a
 * grandchild the root left behind (that is what
 * providerProcessTeardown.test.ts asserts, and it holds). Windows has no such
 * group: the teardown is `taskkill /PID <root> /T /F`, and `/T` walks *downward*
 * through parent-child links. `killTree` runs in a `finally` reached only after
 * the root's `close`, so on the natural-completion path the root is already
 * gone and there is no tree left to walk. `detached: !isWindows` at every
 * provider launch makes the group mechanism POSIX-only by construction.
 *
 * The result: on win32 a provider can start a short-lived helper that itself
 * starts a second process and exits, and that grandchild survives the toggle
 * returning to Ask — no `setsid`, no double-fork, no deliberate escape. (A
 * *direct* child of the exited root does not escape: Windows never reparents,
 * so its stale parent link still points at the root pid, which Node keeps
 * resolvable, and `/T` walks it. Measured on windows-latest, run 34190351905.)
 * 0.1.13 shipped with this limit *named* in the Ask/Agent toggle and the
 * consent dialog rather than closed; closing it needs a per-request Job
 * Object, which this plugin cannot create without a native dependency.
 *
 * This test exists because CI could not see the limit at all: both real
 * descendant-reaping suites skip win32, so `windows-latest` had never verified
 * the property in either direction. It asserts the *weak* behaviour on purpose.
 *
 * How to read a result:
 * - Survival observed -> the limitation reproduces on this runner. That is all
 *   it establishes: not reliability across locked-down student laptops, and not
 *   containment.
 * - Survival NOT observed -> this does not falsify the mechanism. Fixture
 *   startup, timing, the runner environment, cleanup interference, or a genuine
 *   behavioural improvement each explain it. Diagnose which before concluding.
 *   If teardown really did start reaping, promote this to a regression test
 *   asserting successful teardown instead of deleting it.
 */

const HEARTBEAT_MS = 100;
// Self-limiting: the descendant exits on its own even if afterEach never runs,
// so a crashed test cannot leave a process burning CPU on the runner.
const HEARTBEAT_COUNT = 200;

/**
 * A shim/.js pair in the shape the Windows dispatch path actually resolves —
 * the same layout `writeFixtureCli` in directProcessDispatch.test.ts writes,
 * because dispatch no longer uses a shell and cannot launch a bare `.cmd`.
 *
 * Three levels deep on purpose. A *direct* child of the exited root is not the
 * limitation: Windows never reparents, so the orphan's recorded parent pid
 * still points at the root, and while Node holds the root's process handle
 * that pid stays resolvable — `taskkill /T` walks the stale link and reaps it.
 * CI observed exactly that (run 34190351905, windows-latest: the depth-2
 * descendant was killed before its first heartbeat). The limitation needs the
 * *middle* parent gone, which severs the link `/T` would have walked while
 * leaving the grandchild running.
 */
function writeOrphanFixture(
  dir: string,
  readyPath: string,
  beatPath: string,
  middleDonePath: string
): string {
  const grandchildPath = path.join(dir, 'orphan-grandchild.js');
  fs.writeFileSync(
    grandchildPath,
    [
      "const fs = require('fs');",
      'const [readyPath, beatPath] = process.argv.slice(2);',
      // One beat before the readiness signal, so "ready exists but zero beats"
      // is impossible and a zero count can only mean the fixture never ran.
      "fs.appendFileSync(beatPath, 'x');",
      // Readiness signal: the grandchild announces its own pid once it is
      // actually running. Liveness is never inferred from a sleep.
      'fs.writeFileSync(readyPath, String(process.pid));',
      'let n = 0;',
      'const t = setInterval(() => {',
      "  fs.appendFileSync(beatPath, 'x');",
      `  if (++n >= ${HEARTBEAT_COUNT}) { clearInterval(t); }`,
      `}, ${HEARTBEAT_MS});`,
    ].join('\n')
  );

  const sleepSrc =
    'const sleep = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);';

  // Ordinary CreateProcess. No detach, no shell, nothing evasive — this is the
  // point: the plain case already escapes.
  const spawnSrc = (target: string, args: string[]) =>
    [
      `const child = spawn(process.execPath, [${[target, ...args].map((a) => JSON.stringify(a)).join(', ')}], {`,
      "  stdio: 'ignore',",
      '  windowsHide: true,',
      '});',
      'child.unref();',
    ].join('\n');

  const middlePath = path.join(dir, 'orphan-middle.js');
  fs.writeFileSync(
    middlePath,
    [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      spawnSrc(grandchildPath, [readyPath, beatPath]),
      sleepSrc,
      // Do not exit until the grandchild is provably up, then leave. From here
      // on the grandchild has no live parent between it and the root.
      `for (let i = 0; i < 200 && !fs.existsSync(${JSON.stringify(readyPath)}); i++) sleep();`,
      `fs.writeFileSync(${JSON.stringify(middleDonePath)}, 'done');`,
      'process.exit(0);',
    ].join('\n')
  );

  const rootPath = path.join(dir, 'fake-orphan-cli.js');
  fs.writeFileSync(
    rootPath,
    [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      spawnSrc(middlePath, []),
      sleepSrc,
      // Block until the middle parent has exited, so the root cannot exit
      // first and turn "never started" into a false negative.
      `for (let i = 0; i < 200 && !fs.existsSync(${JSON.stringify(middleDonePath)}); i++) sleep();`,
      // agy is the raw-passthrough provider: whatever is printed becomes the
      // chunk text unchanged.
      "process.stdout.write('orphan-fixture-ok\\n');",
    ].join('\n')
  );

  const shimPath = path.join(dir, 'fake-orphan-cli.cmd');
  fs.writeFileSync(
    shimPath,
    '@ECHO off\r\nSET dp0=%~dp0\r\n"%_prog%"  "%dp0%\\fake-orphan-cli.js" %*\r\n'
  );
  return shimPath;
}

const makeService = (cliPath: string, vault: string) =>
  new CopilotBridgeService(
    {
      settings: { ...DEFAULT_SETTINGS, selectedProvider: 'agy', providerCliPaths: { agy: cliPath } },
      app: { vault: { adapter: { basePath: vault } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin
  );

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const beats = (beatPath: string): number =>
  fs.existsSync(beatPath) ? fs.statSync(beatPath).size : 0;

const maybe = process.platform === 'win32' ? describe : describe.skip;

maybe('killTree on win32 (characterization of a known, shipped limitation)', () => {
  let dir: string;
  let readyPath: string;
  let beatPath: string;
  let middleDonePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win32-teardown-limit-'));
    readyPath = path.join(dir, 'grandchild-ready.txt');
    beatPath = path.join(dir, 'grandchild-beats.txt');
    middleDonePath = path.join(dir, 'middle-exited.txt');
  });

  // Cleanup runs independently of the assertion: a red test must not leave
  // processes on the runner.
  afterEach(() => {
    if (fs.existsSync(readyPath)) {
      const pid = fs.readFileSync(readyPath, 'utf8').trim();
      if (/^\d+$/.test(pid)) {
        spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it(
    'known limitation (win32): a grandchild whose middle parent already exited survives killTree',
    async () => {
      const cli = writeOrphanFixture(dir, readyPath, beatPath, middleDonePath);
      const service = makeService(cli, dir);

      for await (const chunk of service.query('hello')) {
        void chunk;
      }
      // The iterator has settled, so the `finally` that calls killTree has run.

      // Readiness, not timing: the grandchild told us it was alive and its
      // middle parent had exited before the root did. Without this the
      // assertion below could pass on a fixture that never started.
      expect(fs.existsSync(readyPath)).toBe(true);
      expect(fs.existsSync(middleDonePath)).toBe(true);

      // Bounded wait for fresh heartbeats. A pid check would only prove an
      // entry exists (and pids are reused); a growing heartbeat file proves the
      // orphan is still executing after teardown. `before >= 1` separates
      // "started, then killed" from "never ran" when this goes red.
      const before = beats(beatPath);
      expect(before).toBeGreaterThanOrEqual(1);
      let after = before;
      for (let i = 0; i < 20 && after <= before; i++) {
        await wait(HEARTBEAT_MS);
        after = beats(beatPath);
      }

      expect(after).toBeGreaterThan(before);
    },
    30_000
  );
});
