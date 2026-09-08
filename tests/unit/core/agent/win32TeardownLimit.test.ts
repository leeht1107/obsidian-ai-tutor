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
 * The result: on win32 a provider can start a second process with an ordinary
 * `CreateProcess` and exit, and that process survives the toggle returning to
 * Ask — no `setsid`, no double-fork, no deliberate escape. 0.1.13 shipped with
 * this limit *named* in the Ask/Agent toggle and the consent dialog rather than
 * closed; closing it needs a per-request Job Object, which this plugin cannot
 * create without a native dependency.
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
 */
function writeOrphanFixture(dir: string, readyPath: string, beatPath: string): string {
  const descendantPath = path.join(dir, 'orphan-descendant.js');
  fs.writeFileSync(
    descendantPath,
    [
      "const fs = require('fs');",
      'const [readyPath, beatPath] = process.argv.slice(2);',
      // Readiness signal: the descendant announces its own pid once it is
      // actually running. Liveness is never inferred from a sleep.
      'fs.writeFileSync(readyPath, String(process.pid));',
      'let n = 0;',
      'const t = setInterval(() => {',
      "  fs.appendFileSync(beatPath, 'x');",
      `  if (++n >= ${HEARTBEAT_COUNT}) { clearInterval(t); }`,
      `}, ${HEARTBEAT_MS});`,
    ].join('\n')
  );

  const rootPath = path.join(dir, 'fake-orphan-cli.js');
  fs.writeFileSync(
    rootPath,
    [
      "const fs = require('fs');",
      "const { spawn } = require('child_process');",
      `const readyPath = ${JSON.stringify(readyPath)};`,
      `const beatPath = ${JSON.stringify(beatPath)};`,
      // Ordinary CreateProcess. No detach, no shell, nothing evasive — this is
      // the point: the plain case already escapes.
      `const child = spawn(process.execPath, [${JSON.stringify(descendantPath)}, readyPath, beatPath], {`,
      "  stdio: 'ignore',",
      '  windowsHide: true,',
      '});',
      'child.unref();',
      // Block until the descendant proves it started, so the root cannot exit
      // first and turn "never started" into a false negative.
      'const sleep = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);',
      'for (let i = 0; i < 200 && !fs.existsSync(readyPath); i++) sleep();',
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

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win32-teardown-limit-'));
    readyPath = path.join(dir, 'descendant-ready.txt');
    beatPath = path.join(dir, 'descendant-beats.txt');
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
    'known limitation (win32): a descendant orphaned before teardown survives killTree',
    async () => {
      const cli = writeOrphanFixture(dir, readyPath, beatPath);
      const service = makeService(cli, dir);

      for await (const chunk of service.query('hello')) {
        void chunk;
      }
      // The iterator has settled, so the `finally` that calls killTree has run.

      // Readiness, not timing: the descendant told us it was alive before the
      // root exited. Without this the assertion below could pass on a fixture
      // that never started.
      expect(fs.existsSync(readyPath)).toBe(true);

      // Bounded wait for fresh heartbeats. A pid check would only prove an
      // entry exists (and pids are reused); a growing heartbeat file proves the
      // orphan is still executing after teardown.
      const before = beats(beatPath);
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
