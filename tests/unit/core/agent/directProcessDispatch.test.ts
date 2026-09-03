import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { McpServerManager } from '@/core/mcp';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/**
 * Deterministic proof for the direct native-provider dispatch seam
 * (`CopilotBridgeService#querySelectedProvider`). Backs
 * .claude/artifacts/obsidian-ai-tutor-20260903-0001/direct-process-performance.md.
 *
 * Uses a tiny fixture CLI instead of a real `claude`/`codex`/`agy` binary so the
 * result is reproducible, offline, and isolated from real provider CLI startup
 * cost — this measures the plugin's own dispatch code, not end-to-end CLI latency.
 */

const isWindows = process.platform === 'win32';

function writeFixtureCli(dir: string): string {
  if (isWindows) {
    const scriptPath = path.join(dir, 'fake-provider-cli.cmd');
    fs.writeFileSync(scriptPath, '@echo off\r\necho {"delta":{"text":"dispatch-fixture-ok"}}\r\n');
    return scriptPath;
  }
  const scriptPath = path.join(dir, 'fake-provider-cli.sh');
  fs.writeFileSync(scriptPath, '#!/bin/sh\nprintf \'%s\\n\' \'{"delta":{"text":"dispatch-fixture-ok"}}\'\n');
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function makeService(fixturePath: string, vaultPath: string): CopilotBridgeService {
  const fakePlugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      selectedProvider: 'claude',
      providerCliPaths: { claude: fixturePath },
    },
    app: { vault: { adapter: { basePath: vaultPath } } },
    getActiveEnvironmentVariables: () => '',
  } as unknown as ObsidianCopilotPlugin;
  const fakeMcpManager = { getServers: () => [] } as unknown as McpServerManager;
  return new CopilotBridgeService(fakePlugin, fakeMcpManager);
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
