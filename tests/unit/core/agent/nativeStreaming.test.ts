import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/**
 * The native CLIs are asked for a streaming format, so their output must reach the UI as it
 * arrives. Buffering until process exit turns a 1s first token into a 13s blank wait — the
 * CLI is not what is slow, the transport is. These fixtures emit slowly on purpose so a
 * passing assertion proves chunks were yielded *before* the child exited.
 */
const write = (dir: string, name: string, body: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
};

const makeService = (cliPath: string, vault: string, provider: 'claude' | 'codex' | 'agy') =>
  new CopilotBridgeService(
    {
      settings: { ...DEFAULT_SETTINGS, selectedProvider: provider, providerCliPaths: { [provider]: cliPath } },
      app: { vault: { adapter: { basePath: vault } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin
  );

const maybe = process.platform === 'win32' ? describe.skip : describe;

maybe('native provider streaming', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-streaming-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('delivers each chunk as it is produced, not after the process exits', async () => {
    // Emits, then stays alive well past the emission — a buffering implementation
    // cannot produce the chunk until the sleep is over.
    const cli = write(dir, 'slow-claude.sh',
      `printf '%s\\n' '{"delta":{"text":"first-token"}}'\nsleep 2\nprintf '%s\\n' '{"delta":{"text":"last-token"}}'`);
    const service = makeService(cli, dir, 'claude');

    const t0 = Date.now();
    let firstTextAt = -1;
    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('p')) {
      if (firstTextAt < 0 && chunk.type === 'text' && chunk.content.includes('first-token')) {
        firstTextAt = Date.now() - t0;
      }
      chunks.push(chunk);
    }
    const total = Date.now() - t0;

    expect(firstTextAt).toBeGreaterThanOrEqual(0);
    expect(total).toBeGreaterThanOrEqual(1800);
    // The whole point: the first token is visible long before the child is done.
    expect(firstTextAt).toBeLessThan(1000);
    expect(chunks.some((c) => c.type === 'text' && c.content.includes('last-token'))).toBe(true);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  }, 20000);

  it('does not turn a successful run\'s stderr notices into an error bubble', async () => {
    // Every CLI here writes progress and notices to stderr. Only a non-zero exit is a failure.
    const cli = write(dir, 'chatty.sh',
      `printf '%s\\n' 'Reading additional input from stdin...' >&2\nprintf '%s\\n' '{"delta":{"text":"fine"}}'\nexit 0`);
    const service = makeService(cli, dir, 'claude');
    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('p')) chunks.push(chunk);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(chunks.some((c) => c.type === 'text' && c.content.includes('fine'))).toBe(true);
  }, 20000);

  it('keeps two codex agent_message blocks on separate lines', async () => {
    // codex is block-buffered: measured at codex-cli 0.153.4, a turn that uses a tool
    // emits a preamble message, a text-less command_execution, then the answer. Nothing
    // else marks a boundary, so without one here the two glue into
    // `...작성합니다.## 1/5번 문제` and the quiz header stops starting a line.
    const cli = write(dir, 'codex-blocks.sh',
      `printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"[Solo] 노트를 읽고 작성합니다."}}'
printf '%s\\n' '{"type":"item.started","item":{"type":"command_execution"}}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"command_execution"}}'
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"## 1/5번 문제"}}'`);
    const service = makeService(cli, dir, 'codex');

    let text = '';
    for await (const chunk of service.query('p')) {
      if (chunk.type === 'text') text += chunk.content;
    }

    expect(text).toBe('[Solo] 노트를 읽고 작성합니다.\n## 1/5번 문제\n');
    // Exactly one boundary — not zero (glued) and not two (a blank line each time).
    expect(text.split('작성합니다.')[1].indexOf('##')).toBe(1);
    expect(/^##\s*1\s*\/\s*5번 문제/m.test(text)).toBe(true);
  }, 20000);

  it('kills the child when the consumer walks away mid-stream', async () => {
    // ai-review consensus (codex M1 / gemini B1): abandoning the iterator previously left a
    // real CLI running on the user's machine, burning CPU and API quota with no owner.
    const marker = path.join(dir, 'still-alive.txt');
    const cli = write(dir, 'long-runner.sh',
      `printf '%s\n' '{"delta":{"text":"tick"}}'
sleep 5
printf 'survived\n' > '${marker}'`);
    const service = makeService(cli, dir, 'claude');

    for await (const chunk of service.query('p')) {
      if (chunk.type === 'text') break;          // walk away after the first token
    }
    await new Promise((r) => setTimeout(r, 6500));
    expect(fs.existsSync(marker)).toBe(false);    // the sleep never completed
  }, 20000);

  it('reports a failure that wrote nothing to stderr instead of showing an empty answer', async () => {
    const cli = write(dir, 'silent-fail.sh', 'exit 3');
    const service = makeService(cli, dir, 'claude');
    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('p')) chunks.push(chunk);
    const err = chunks.find((c) => c.type === 'error');
    expect(err).toBeDefined();
    expect(err && err.content).toMatch(/3/);
  }, 20000);

  it('does not report an error when the user cancelled the run', async () => {
    // SIGTERM makes close() report code null, and these CLIs leave benign stderr behind,
    // so a naive check turns a deliberate stop into an error bubble.
    const cli = write(dir, 'cancellable.sh',
      `printf '%s\n' 'Reading additional input from stdin...' >&2
printf '%s\n' '{"delta":{"text":"tick"}}'
sleep 5`);
    const service = makeService(cli, dir, 'claude');
    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('p')) {
      chunks.push(chunk);
      if (chunk.type === 'text') service.cancel();
    }
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  }, 20000);

  it('yields an error chunk instead of throwing when the CLI cannot be started', async () => {
    const cli = write(dir, 'unstartable.sh', 'exit 0');
    const service = makeService(cli, dir, 'claude');
    jest.spyOn(childProcess, 'spawn').mockImplementation(() => { throw new Error('EACCES boom'); });
    const chunks: StreamChunk[] = [];
    await expect((async () => { for await (const c of service.query('p')) chunks.push(c); })()).resolves.toBeUndefined();
    expect(chunks.some((c) => c.type === 'error' && c.content.includes('EACCES boom'))).toBe(true);
    jest.restoreAllMocks();
  }, 20000);

  it('still surfaces stderr when the CLI actually fails', async () => {
    const cli = write(dir, 'failing.sh', `printf '%s\\n' 'boom: not logged in' >&2\nexit 1`);
    const service = makeService(cli, dir, 'claude');
    const chunks: StreamChunk[] = [];
    for await (const chunk of service.query('p')) chunks.push(chunk);
    expect(chunks.some((c) => c.type === 'error' && c.content.includes('boom: not logged in'))).toBe(true);
  }, 20000);
});
