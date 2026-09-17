import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/**
 * Deterministic proof for the direct native-provider dispatch seam
 * (`CopilotBridgeService#querySelectedProvider`). Backs
 * .claude/artifacts/obsidian-ai-tutor-20260903-0001/direct-process-performance.md
 * and .claude/artifacts/obsidian-ai-tutor-20260903-0001/claude-provider-parsing-repair.md.
 *
 * Uses a tiny fixture CLI instead of a real `claude`/`codex`/`agy` binary so the
 * result is reproducible, offline, and isolated from real provider CLI startup
 * cost — this measures the plugin's own dispatch code, not end-to-end CLI latency.
 */

const isWindows = process.platform === 'win32';

type FixtureProvider = 'claude' | 'codex' | 'agy';

// Exact stdout line each fixture CLI emits. Values are chosen so a passing
// assertion proves *how* the line was turned into a chunk, not just that a
// chunk was emitted:
// - claude/codex: valid JSON whose parsed field content differs from the raw
//   line, so seeing only the inner text (not the surrounding JSON) proves
//   parseNativeProviderLine actually parsed and extracted it.
// - agy: a JSON-*shaped* line that would parse cleanly if fed through
//   JSON.parse, so seeing the raw braces/quotes come through unmodified
//   proves agy's branch never attempts JSON parsing at all (raw passthrough).
const FIXTURE_LINE: Record<FixtureProvider, string> = {
  claude: '{"delta":{"text":"dispatch-fixture-ok"}}',
  codex: '{"item":{"text":"codex-fixture-ok"}}',
  agy: '{"status":"SUCCESS","response":"agy-fixture-ok","denied_actions":[]}',
};

function writeFixtureCli(dir: string, provider: FixtureProvider = 'claude', output = FIXTURE_LINE[provider]): string {
  const line = output;
  if (isWindows) {
    // A real npm-style shim in front of a real .js, not a bare `echo` batch file.
    // Dispatch no longer uses a shell, so nothing can launch a plain .cmd — and
    // the old fixture never exercised the shim parsing that every Windows
    // student's install depends on. This one does.
    const jsPath = path.join(dir, `fake-${provider}-cli.js`);
    fs.writeFileSync(jsPath, `process.stdout.write(${JSON.stringify(line + '\n')});\n`);
    const scriptPath = path.join(dir, `fake-${provider}-cli.cmd`);
    fs.writeFileSync(
      scriptPath,
      `@ECHO off\r\nSET dp0=%~dp0\r\n"%_prog%"  "%dp0%\\fake-${provider}-cli.js" %*\r\n`
    );
    return scriptPath;
  }
  const scriptPath = path.join(dir, `fake-${provider}-cli.sh`);
  fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' '${line}'\n`);
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

/**
 * On Windows the shim is resolved to [node, script.js] before spawning, so the
 * command is the interpreter and the fixture appears as its first argument.
 * Everywhere else the fixture is spawned directly.
 */
/**
 * The provider spawns only, with the teardown helper filtered out.
 *
 * `killTree` has no Windows equivalent of a process group, so on win32 it
 * reaps by spawning `taskkill /T /F`. That is a second real child process, but
 * it belongs to the teardown path, not the dispatch path — counting it would
 * turn "one child per request" into a claim that silently fails on one
 * platform while passing on the other, which is exactly how this went
 * unnoticed until CI ran windows-latest.
 */
function providerSpawnCalls(
  spy: jest.SpyInstance<childProcess.ChildProcess, Parameters<typeof childProcess.spawn>>
): Parameters<typeof childProcess.spawn>[] {
  return spy.mock.calls.filter((call) => !String(call[0]).toLowerCase().includes('taskkill'));
}

function expectSpawnedFixture(call: Parameters<typeof childProcess.spawn>, fixturePath: string): void {
  const [command, args] = call as unknown as [string, string[]];
  if (isWindows) {
    expect(command).toMatch(/node(\.exe)?$/i);
    expect(args[0]).toBe(fixturePath.replace(/\.cmd$/i, '.js'));
  } else {
    expect(command).toBe(fixturePath);
  }
}

function makeService(
  fixturePath: string,
  vaultPath: string,
  provider: FixtureProvider = 'claude',
  settingsOverrides: Record<string, unknown> = {},
  pluginOverrides: Record<string, unknown> = {},
): CopilotBridgeService {
  const fakePlugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      selectedProvider: provider,
      providerCliPaths: { [provider]: fixturePath },
      ...settingsOverrides,
    },
    app: { vault: { adapter: { basePath: vaultPath } } },
    getActiveEnvironmentVariables: () => '',
    ...pluginOverrides,
  } as unknown as ObsidianCopilotPlugin;
  return new CopilotBridgeService(fakePlugin);
}

describe('direct native-provider dispatch (non-Copilot providers)', () => {
  let tmpDir: string;
  let fixturePath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-process-dispatch-'));
    fixturePath = writeFixtureCli(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates exactly one direct native child process and no proxy/relay/extra child', async () => {
    const spawnSpy = jest.spyOn(childProcess, 'spawn');
    const execFileSpy = jest.spyOn(childProcess, 'execFile');
    const execSpy = jest.spyOn(childProcess, 'exec');
    const forkSpy = jest.spyOn(childProcess, 'fork');

    const service = makeService(fixturePath, tmpDir);
    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('proof prompt')) {
      chunks.push(chunk);
    }

    // Exactly one native child for the whole request — no shared runtime, proxy,
    // queue, RPC hop, or stream relay process in between.
    const providerCalls = providerSpawnCalls(spawnSpy);
    expect(providerCalls).toHaveLength(1);
    expectSpawnedFixture(providerCalls[0], fixturePath);
    const nativeArgs = providerCalls[0][1] as string[];
    expect(nativeArgs.slice(-4, -1)).toEqual(['--output-format', 'stream-json', '--verbose']);
    // The prompt goes last, behind every flag, or a variadic one swallows it.
    expect(nativeArgs[nativeArgs.length - 1]).toContain('proof prompt');
    expect(execFileSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    expect(forkSpy).not.toHaveBeenCalled();

    expect(chunks.some((c) => c.type === 'text' && c.content.includes('dispatch-fixture-ok'))).toBe(true);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('keeps in-process dispatch overhead (up to the spawn() call) at p95 <= 10ms', async () => {
    const SAMPLE_SIZE = 200;
    const samples: number[] = [];
    let dispatchStart = 0;
    const realSpawn = childProcess.spawn;

    jest.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof childProcess.spawn>) => {
      // Recorded before delegating to the real spawn(): this is pure JS-side
      // dispatch overhead (prompt/arg build, CLI path resolution, env build),
      // not the OS process start or the CLI's own runtime.
      // Same reason as providerSpawnCalls: the win32 teardown spawns taskkill,
      // and timing that would measure the reaper, not dispatch overhead.
      if (!String(args[0]).toLowerCase().includes('taskkill')) {
        samples.push(performance.now() - dispatchStart);
      }
      return (realSpawn as (...a: Parameters<typeof childProcess.spawn>) => childProcess.ChildProcess)(...args);
    });

    const service = makeService(fixturePath, tmpDir);

    for (let i = 0; i < SAMPLE_SIZE; i++) {
      dispatchStart = performance.now();
      // eslint-disable-next-line no-await-in-loop -- sequential samples by design
      for await (const chunk of service.query(`proof prompt ${i}`)) {
        // Drain fully so each real fixture process exits before the next sample starts.
        void chunk;
      }
    }

    expect(samples).toHaveLength(SAMPLE_SIZE);
    const sorted = [...samples].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const p50 = percentile(0.5);
    const p95 = percentile(0.95);
    const p99 = percentile(0.99);
    const max = sorted[sorted.length - 1];

    // eslint-disable-next-line no-console -- percentile evidence surfaced in test output
    console.log(
      `[direct-process-dispatch] samples=${SAMPLE_SIZE} p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms`
    );

    expect(p95).toBeLessThanOrEqual(10);
  }, 60_000);
});

describe('native provider response parsing (codex, agy) via the real query() -> querySelectedProvider() path', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-process-parsing-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses Codex CLI JSON output (item.text) into an extracted text chunk, not a raw JSON dump', async () => {
    const fixturePath = writeFixtureCli(tmpDir, 'codex');
    const spawnSpy = jest.spyOn(childProcess, 'spawn');
    const service = makeService(fixturePath, tmpDir, 'codex');

    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('codex proof prompt')) {
      chunks.push(chunk);
    }

    const providerCalls = providerSpawnCalls(spawnSpy);
    expect(providerCalls).toHaveLength(1);
    expectSpawnedFixture(providerCalls[0], fixturePath);

    // The fixture's raw stdout line is '{"item":{"text":"codex-fixture-ok"}}'.
    // Asserting the emitted text chunk is the extracted string alone (no
    // surrounding braces/quotes) proves parseNativeProviderLine's codex
    // branch actually parsed the JSON and pulled out `item.text`, rather
    // than falling back to raw-line passthrough.
    const textChunks = chunks.filter((c): c is Extract<StreamChunk, { type: 'text' }> => c.type === 'text');
    expect(textChunks).toHaveLength(1);
    expect(textChunks[0].content).toBe('codex-fixture-ok');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('accepts only Agy SUCCESS JSON with a response and no denied action', async () => {
    const fixturePath = writeFixtureCli(tmpDir, 'agy');
    const spawnSpy = jest.spyOn(childProcess, 'spawn');
    const service = makeService(fixturePath, tmpDir, 'agy');

    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('agy proof prompt')) {
      chunks.push(chunk);
    }

    const providerCalls = providerSpawnCalls(spawnSpy);
    expect(providerCalls).toHaveLength(1);
    expectSpawnedFixture(providerCalls[0], fixturePath);

    const textChunks = chunks.filter((c): c is Extract<StreamChunk, { type: 'text' }> => c.type === 'text');
    expect(textChunks).toHaveLength(1);
    expect(textChunks[0].content).toBe('agy-fixture-ok');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it.each([
    ['denied action outranks SUCCESS and partial response', '{"status":"SUCCESS","response":"먼저 해볼게요","denied_actions":[{"action":"command"}]}', '권한'],
    ['provider error', '{"status":"ERROR","response":"","denied_actions":[]}', '실패 상태'],
    ['malformed JSON', 'not-json', '최신 버전'],
    ['empty response', '{"status":"SUCCESS","response":"","denied_actions":[]}', '아무 답도'],
  ])('rejects Agy %s', async (_name, output, expectedError) => {
    const fixturePath = writeFixtureCli(tmpDir, 'agy', output);
    const service = makeService(fixturePath, tmpDir, 'agy');
    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('agy failure prompt')) chunks.push(chunk);

    expect(chunks.some((chunk) => chunk.type === 'text')).toBe(false);
    expect(chunks.some((chunk) => chunk.type === 'error' && chunk.content.includes(expectedError))).toBe(true);
  });

  it.each(['claude', 'codex'] as const)('does not promote malformed %s JSON stdout to an answer', async (provider) => {
    const fixturePath = writeFixtureCli(tmpDir, provider, 'plain text that is not JSON');
    const service = makeService(fixturePath, tmpDir, provider);
    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query(`${provider} malformed prompt`)) chunks.push(chunk);

    expect(chunks.some((chunk) => chunk.type === 'text')).toBe(false);
    expect(chunks.some((chunk) => chunk.type === 'error' && chunk.content.includes('JSON'))).toBe(true);
  });

  it('adds Agy dangerous permissions only when the expert setting and current grant are both present', async () => {
    const fixturePath = writeFixtureCli(tmpDir, 'agy');
    const spawnSpy = jest.spyOn(childProcess, 'spawn');

    const blocked = makeService(fixturePath, tmpDir, 'agy', {
      permissionMode: 'agent', blanketWriteAcknowledged: ['agy'], allowUnsafeAgyAgent: false,
    });
    for await (const chunk of blocked.query('blocked')) { void chunk; }
    const blockedArgs = providerSpawnCalls(spawnSpy).at(-1)?.[1] as string[];
    expect(blockedArgs).not.toContain('--dangerously-skip-permissions');
    expect(blockedArgs[blockedArgs.indexOf('-p') + 1]).not.toContain('AgentOutputTool');

    const allowed = makeService(fixturePath, tmpDir, 'agy', {
      permissionMode: 'agent', blanketWriteAcknowledged: ['agy'], allowUnsafeAgyAgent: true,
    });
    for await (const chunk of allowed.query('allowed')) { void chunk; }
    const allowedArgs = providerSpawnCalls(spawnSpy).at(-1)?.[1] as string[];
    expect(allowedArgs).toContain('--dangerously-skip-permissions');
    expect(allowedArgs[allowedArgs.indexOf('-p') + 1]).toContain('AgentOutputTool');
  });

  it('records a content-free permission-denied diagnostic for Agy', async () => {
    const fixturePath = writeFixtureCli(
      tmpDir,
      'agy',
      '{"status":"SUCCESS","response":"partial private answer","denied_actions":[{"type":"command"}]}',
    );
    let written = '';
    const adapter = {
      basePath: tmpDir,
      exists: async () => false,
      read: async () => '',
      write: async (_path: string, content: string) => { written = content; },
    };
    const service = makeService(fixturePath, tmpDir, 'agy', {}, {
      app: { vault: { adapter } },
      storage: { getAdapter: () => adapter },
      manifest: { version: '0.1.22' },
    });

    for await (const chunk of service.query('SECRET PROMPT')) { void chunk; }
    await new Promise((resolve) => setImmediate(resolve));
    const logged = JSON.parse(written.trim());

    expect(logged.diagnostic).toMatchObject({
      code: 'permission-denied', effectiveMode: 'ask', autoApproveTools: false,
      providerStatus: 'SUCCESS', deniedActions: ['command'], responseLength: 22,
    });
    expect(written).not.toContain('partial private answer');
    expect(written).not.toContain('SECRET PROMPT');
  });
});
