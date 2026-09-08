import * as childProcess from 'child_process';
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
 * starts a *detached* process and exits, and that grandchild survives the
 * toggle returning to Ask. It is not free, though — see the fixture docblock:
 * two weaker shapes were measured on windows-latest and both were reaped, so
 * this needs `detached` plus a dead intermediate, not merely "spawn and exit".
 * 0.1.13 shipped with this limit *named* in the Ask/Agent toggle and the
 * consent dialog rather than closed; closing it needs a per-request Job
 * Object, which this plugin cannot create without a native dependency.
 *
 * This test exists because CI could not see the limit at all: both real
 * descendant-reaping suites skip win32, so `windows-latest` had never verified
 * the property in either direction. It asserts the *weak* behaviour on purpose.
 *
 * Survival alone would not be enough evidence, though: a regression that
 * removed the `killTree` call entirely would leave this suite green for the
 * exact opposite of the reason it exists. So the teardown seam is asserted
 * too, by pid, through the same `spawn` spy directProcessDispatch.test.ts uses.
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
 * - Teardown assertion red while survival is green -> the seam is gone. That is
 *   a product regression, not a test problem.
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
 * Three levels deep, with the grandchild `detached`. Both parts were forced by
 * measurement, not guessed:
 *
 * - A *direct* child of the exited root does not escape. Windows never
 *   reparents, so its recorded parent pid still points at the root, which Node
 *   keeps resolvable, and `/T` walks the stale link. (windows-latest, run
 *   34190351905: killed before its first heartbeat.)
 * - A non-detached grandchild does not escape either, and not because of
 *   `/T` at all — it dies the moment its middle parent exits. On Windows a
 *   child spawned without `detached: true` does not outlive its parent, which
 *   Node documents. (Run 34190812354: startup beat written, then nothing.)
 *
 * So a plain `CreateProcess` chain is *not* the escape hatch. `detached: true`
 * is what buys the grandchild its own lifetime, and a dead middle parent is
 * what severs the link `/T` would otherwise walk. That pairing is the moral
 * equivalent of the POSIX suite's `sh -c '...' &`, which also escapes through a
 * grandchild.
 *
 * The root waits on the middle's `exit` *event*, not on a done-marker file. A
 * file write is flushed before the kernel finishes tearing the process down, so
 * a marker would let the root exit while the middle was still a walkable link
 * in the tree — on a loaded runner `/T` would then reap the grandchild and this
 * suite would flake red for a reason that has nothing to do with the product.
 * A live child handle also keeps the root alive with no polling at all.
 */
function writeOrphanFixture(
  dir: string,
  readyPath: string,
  beatPath: string,
  grandchildPidPath: string
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

  const middlePath = path.join(dir, 'orphan-middle.js');
  fs.writeFileSync(
    middlePath,
    [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      // No shell and nothing evasive; `detached` is the one flag that matters,
      // and only the grandchild gets it (see the docblock — without it the
      // grandchild dies with its middle parent and the limitation never shows).
      `const child = spawn(process.execPath, [${[grandchildPath, readyPath, beatPath].map((a) => JSON.stringify(a)).join(', ')}], {`,
      "  stdio: 'ignore',",
      '  windowsHide: true,',
      '  detached: true,',
      '});',
      // Cleanup handle, written before anything can block. afterEach needs a pid
      // even when the grandchild never reaches its own readiness write.
      // Residual window, deliberately left open: if the middle dies between
      // spawn() returning and this line, afterEach cannot reach the grandchild.
      // HEARTBEAT_COUNT bounds that orphan to ~20s, which is why it stays.
      `fs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(child.pid));`,
      'child.unref();',
      sleepSrc,
      // Do not exit until the grandchild is provably up, then leave. From here
      // on the grandchild has no live parent between it and the root.
      // Polling a file is right here: this waits on another process's side
      // effect, not on a child of its own whose exit it could listen for.
      `for (let i = 0; i < 200 && !fs.existsSync(${JSON.stringify(readyPath)}); i++) sleep();`,
      'process.exit(0);',
    ].join('\n')
  );

  const rootPath = path.join(dir, 'fake-orphan-cli.js');
  fs.writeFileSync(
    rootPath,
    [
      "const { spawn } = require('child_process');",
      `const child = spawn(process.execPath, [${JSON.stringify(middlePath)}], {`,
      "  stdio: 'ignore',",
      '  windowsHide: true,',
      '  detached: false,',
      '});',
      // No unref: the live handle keeps the root alive until libuv reports the
      // middle's real termination, so the root cannot exit first and turn
      // "never started" into a false negative.
      // agy is the raw-passthrough provider: whatever is printed becomes the
      // chunk text unchanged.
      "child.on('exit', () => { process.stdout.write('orphan-fixture-ok\\n'); });",
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

type SpawnSpy = jest.SpyInstance<childProcess.ChildProcess, Parameters<typeof childProcess.spawn>>;

const isTaskkill = (call: Parameters<typeof childProcess.spawn>): boolean =>
  String(call[0]).toLowerCase().includes('taskkill');

/**
 * The teardown spawns only — the exact complement of `providerSpawnCalls` in
 * directProcessDispatch.test.ts, which filters `taskkill` *out* because it
 * belongs to the teardown path and not the dispatch path. Here the teardown
 * path is the thing under test, so the same split is kept and the other half
 * taken. The filter is not shared because it is not exported, and importing it
 * from that `.test.ts` would execute that suite as a side effect.
 */
function teardownSpawnCalls(spy: SpawnSpy): Parameters<typeof childProcess.spawn>[] {
  return spy.mock.calls.filter(isTaskkill);
}

/** The pid of the provider root — the first non-teardown spawn of the request. */
function providerRootPid(spy: SpawnSpy): number | undefined {
  const index = spy.mock.calls.findIndex((call) => !isTaskkill(call));
  if (index < 0) return undefined;
  return (spy.mock.results[index]?.value as childProcess.ChildProcess | undefined)?.pid;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const beats = (beatPath: string): number =>
  fs.existsSync(beatPath) ? fs.statSync(beatPath).size : 0;

const maybe = process.platform === 'win32' ? describe : describe.skip;

maybe('killTree on win32 (characterization of a known, shipped limitation)', () => {
  let dir: string;
  let readyPath: string;
  let beatPath: string;
  let grandchildPidPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win32-teardown-limit-'));
    readyPath = path.join(dir, 'grandchild-ready.txt');
    beatPath = path.join(dir, 'grandchild-beats.txt');
    grandchildPidPath = path.join(dir, 'grandchild-pid.txt');
  });

  // Cleanup runs independently of the assertion *and* of the fixture getting
  // as far as its readiness signal: a red test must not leave processes on the
  // runner. The middle records the pid the moment spawn() returns, so a
  // grandchild that died or hung before writing readyPath is still reachable
  // here. Both sources are read and both are killed when they disagree — a
  // stale-pid kill is harmless, a missed kill is not.
  afterEach(() => {
    const pids = new Set<string>();
    for (const source of [grandchildPidPath, readyPath]) {
      if (!fs.existsSync(source)) continue;
      const pid = fs.readFileSync(source, 'utf8').trim();
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
    for (const pid of pids) {
      spawnSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    }
    fs.rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it(
    'known limitation (win32): a detached grandchild whose middle parent exited survives killTree',
    async () => {
      const cli = writeOrphanFixture(dir, readyPath, beatPath, grandchildPidPath);
      // No mockImplementation: real spawns pass through, the spy only records.
      // `killTree` calls `spawn` through a named import, which ts-jest compiles
      // to a call-time property access, so this sees the teardown too.
      const spawnSpy = jest.spyOn(childProcess, 'spawn');
      const service = makeService(cli, dir);

      for await (const chunk of service.query('hello')) {
        void chunk;
      }
      // The iterator has settled, so the `finally` that calls killTree has run.

      // Readiness, not timing: the grandchild told us it was alive and its
      // middle parent had exited before the root did. Without this the
      // assertion below could pass on a fixture that never started.
      expect(fs.existsSync(readyPath)).toBe(true);

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

      // Teardown really ran, and ran against *this* request's root. Matching
      // the pid is what makes this a proof rather than "some taskkill fired".
      // If this is the only red assertion here, the seam is gone and the
      // survival above is green for the wrong reason.
      const rootPid = providerRootPid(spawnSpy);
      expect(typeof rootPid).toBe('number');
      expect(
        teardownSpawnCalls(spawnSpy).some((call) => {
          const args = (call[1] as string[] | undefined) ?? [];
          return (
            args.includes('/PID') &&
            args.includes(String(rootPid)) &&
            args.includes('/T') &&
            args.includes('/F')
          );
        })
      ).toBe(true);
    },
    30_000
  );
});
