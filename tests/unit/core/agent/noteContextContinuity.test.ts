import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { ChatMessage } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/**
 * A native CLI has no way to resume a conversation. `buildNativeProviderCommand`
 * passes no session flag for claude, codex or agy, so every turn is a fresh
 * process and the replayed transcript is the only continuity there is.
 *
 * `sessionId`, meanwhile, is a copilot concept: only the copilot path assigns it.
 * It was gating the replay for every provider, so one copilot turn anywhere in a
 * conversation left the next claude turn with no history and no current note —
 * the model answering "<current_note> 정보가 없네요" while the UI still showed the
 * note attached.
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

const history: ChatMessage[] = [
  { id: '1', role: 'user', content: '<query>\n이 노트 요약해줘\n</query>', currentNote: '01. Projects/수업계획서.md', timestamp: 1 },
  { id: '2', role: 'assistant', content: '요약했습니다.', timestamp: 2 },
] as unknown as ChatMessage[];

const maybe = process.platform === 'win32' ? describe.skip : describe;

maybe('a native turn after a copilot turn keeps its context', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-context-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  /** Runs one query and returns the prompt the CLI actually received. */
  async function promptSeenByCli(provider: 'claude' | 'codex' | 'agy', sessionId: string | null): Promise<string> {
    const out = path.join(dir, `argv-${provider}-${sessionId ?? 'none'}.txt`);
    const cli = write(dir, `dump-${provider}-${sessionId ?? 'none'}.sh`,
      `for a in "$@"; do last="$a"; done\nprintf '%s' "$last" > '${out}'`);
    const service = makeService(cli, dir, provider);
    service.setSessionId(sessionId);
    // Drained rather than inspected: the assertion is on what the CLI received.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of service.query('<query>\n지금 어느 노트 보고 있어?\n</query>', undefined, history)) { /* drain */ }
    return fs.readFileSync(out, 'utf8');
  }

  it.each(['claude', 'codex', 'agy'] as const)(
    'replays the transcript to %s even when a copilot session id is set',
    async (provider) => {
      const prompt = await promptSeenByCli(provider, 'a-copilot-session-uuid');
      expect(prompt).toContain('이 노트 요약해줘');
      expect(prompt).toContain('01. Projects/수업계획서.md');
    }
  );

  it('still replays when no session id was ever assigned', async () => {
    const prompt = await promptSeenByCli('claude', null);
    expect(prompt).toContain('이 노트 요약해줘');
  });

  /**
   * The caller now hands over the conversation BEFORE this turn, so the prompt is
   * always what comes next. The removed guard suppressed it whenever the last stored
   * question read the same as the prompt — which is exactly the shape a replayed
   * in-flight turn produced, and would have dropped the question on the floor.
   */
  it('appends the prompt exactly once even when the last stored question reads the same', async () => {
    const question = '<query>\n지금 어느 노트 보고 있어?\n</query>';
    const out = path.join(dir, 'argv-identical.txt');
    const cli = write(dir, 'dump-identical.sh',
      `for a in "$@"; do last="$a"; done\nprintf '%s' "$last" > '${out}'`);
    const service = makeService(cli, dir, 'claude');
    const echoed: ChatMessage[] = [
      ...history,
      { id: '3', role: 'user', content: question, timestamp: 3 },
    ] as unknown as ChatMessage[];

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _chunk of service.query(question, undefined, echoed)) { /* drain */ }

    const prompt = fs.readFileSync(out, 'utf8');
    expect(prompt).toContain('이 노트 요약해줘');
    expect(prompt.split('지금 어느 노트 보고 있어?').length - 1).toBe(2);
    expect(prompt.trimEnd().endsWith('</query>')).toBe(true);
  });
});
