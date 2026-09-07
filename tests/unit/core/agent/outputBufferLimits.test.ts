/**
 * A misbehaving CLI must not be able to grow Obsidian's memory without bound.
 *
 * Both stream handlers appended to a string with no ceiling: `errorOutput +=`
 * for stderr, and a line buffer that only shrank when a newline arrived. A CLI
 * that crashes into a loop, or that streams a long answer with no line breaks,
 * pushes all of it into the renderer process.
 *
 * The two halves are treated differently on purpose. stderr is diagnostic, so
 * the front of it is what matters and the rest can be dropped. stdout is the
 * student's answer, so it is flushed rather than discarded.
 */
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { StreamChunk } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

const OVER_CAP = 3 * 1024 * 1024;

/** A child whose streams are driven by `emit`, then closed with `exitCode`. */
function scriptedChild(emit: (out: EventEmitter, err: EventEmitter) => void, exitCode: number): childProcess.ChildProcess {
  const child = new EventEmitter() as unknown as childProcess.ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  Object.assign(child, { stdout, stderr, stdin: { end: jest.fn(), write: jest.fn() }, kill: jest.fn() });
  setImmediate(() => {
    emit(stdout, stderr);
    (child as unknown as EventEmitter).emit('close', exitCode, null);
  });
  return child;
}

function makeService(): CopilotBridgeService {
  const fakePlugin = {
    settings: {
      ...DEFAULT_SETTINGS,
      selectedProvider: 'claude',
      providerCliPaths: { claude: '/usr/local/bin/claude' },
      blanketWriteAcknowledged: ['claude'],
    },
    app: { vault: { adapter: { basePath: '/vault' } } },
    getActiveEnvironmentVariables: () => '',
  } as unknown as ObsidianCopilotPlugin;
  return new CopilotBridgeService(fakePlugin);
}

async function drain(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

describe('native output buffers are bounded', () => {
  beforeEach(() => {
    jest.spyOn(fs, 'statSync').mockImplementation((() => ({ isFile: () => true }) as fs.Stats) as unknown as typeof fs.statSync);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('caps stderr instead of accumulating everything a failing CLI prints', async () => {
    jest.spyOn(childProcess, 'spawn').mockImplementation(() =>
      scriptedChild((_out, err) => {
        for (let i = 0; i < 3; i++) err.emit('data', Buffer.from('E'.repeat(1024 * 1024)));
      }, 1)
    );

    const chunks = await drain(makeService().query('hello'));
    const error = chunks.find((c) => c.type === 'error') as { content: string } | undefined;

    expect(error).toBeDefined();
    // Well under what was emitted, and the cap is what makes that true.
    expect(error!.content.length).toBeLessThan(OVER_CAP / 2);
  });

  it('flushes an unterminated stdout line instead of buffering it forever', async () => {
    // Three writes of 700 KiB with no newline anywhere. The buffer crosses the
    // cap on the second, so a correct implementation flushes once mid-stream and
    // once more at close — two chunks. Held to close, it would be exactly one.
    jest.spyOn(childProcess, 'spawn').mockImplementation(() =>
      scriptedChild((out) => {
        out.emit('data', Buffer.from('머리말 ' + 'x'.repeat(700 * 1024)));
        out.emit('data', Buffer.from('x'.repeat(700 * 1024)));
        out.emit('data', Buffer.from('x'.repeat(700 * 1024)));
      }, 0)
    );

    const chunks = await drain(makeService().query('hello'));

    const text = chunks.filter((c) => c.type === 'text') as { content: string }[];
    expect(text.some((c) => c.content.includes('머리말'))).toBe(true);
    // More than one chunk is the proof: with no cap the whole stream would sit
    // in the buffer until close and arrive as a single trailing flush.
    expect(text.length).toBeGreaterThan(1);
    // Not reported as the answerless clean exit that guard is for.
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
  });
});
