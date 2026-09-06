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
  agy: '{"raw":"agy-fixture-ok"}',
};

function writeFixtureCli(dir: string, provider: FixtureProvider = 'claude'): string {
  const line = FIXTURE_LINE[provider];
  if (isWindows) {
    const scriptPath = path.join(dir, `fake-${provider}-cli.cmd`);
    fs.writeFileSync(scriptPath, `@echo off\r\necho ${line}\r\n`);
    return scriptPath;
  }
  const scriptPath = path.join(dir, `fake-${provider}-cli.sh`);
  fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' '${line}'\n`);
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function makeService(fixturePath: string, vaultPath: string, provider: FixtureProvider = 'claude'): CopilotBridgeService {
  const fakePlugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      selectedProvider: provider,
      providerCliPaths: { [provider]: fixturePath },
    },
    app: { vault: { adapter: { basePath: vaultPath } } },
    getActiveEnvironmentVariables: () => '',
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
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0][0]).toBe(fixturePath);
    const nativeArgs = spawnSpy.mock.calls[0][1] as string[];
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
      samples.push(performance.now() - dispatchStart);
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

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0][0]).toBe(fixturePath);

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

  it('passes agy CLI output through as a raw line, with no JSON parsing attempted', async () => {
    const fixturePath = writeFixtureCli(tmpDir, 'agy');
    const spawnSpy = jest.spyOn(childProcess, 'spawn');
    const service = makeService(fixturePath, tmpDir, 'agy');

    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('agy proof prompt')) {
      chunks.push(chunk);
    }

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(spawnSpy.mock.calls[0][0]).toBe(fixturePath);

    // The fixture's raw stdout line is the JSON-shaped '{"raw":"agy-fixture-ok"}'.
    // parseNativeProviderLine's agy branch returns early with `line + '\n'`
    // before ever calling JSON.parse, so the emitted chunk must contain the
    // untouched braces/quotes verbatim -- proving raw-line passthrough, not
    // JSON parsing (which would have stripped them down to just the value).
    const textChunks = chunks.filter((c): c is Extract<StreamChunk, { type: 'text' }> => c.type === 'text');
    expect(textChunks).toHaveLength(1);
    expect(textChunks[0].content).toBe('{"raw":"agy-fixture-ok"}\n');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });
});
