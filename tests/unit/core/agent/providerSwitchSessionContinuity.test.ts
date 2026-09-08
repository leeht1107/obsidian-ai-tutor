import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import type { ChatMessage } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

/**
 * `sessionId` is a copilot-only concept: a UUID the plugin invents and hands back to
 * the CLI turn after turn so COPILOT holds the conversation, instead of the plugin
 * replaying the transcript itself (`holdsItsOwnSession` in CopilotBridgeService). Only
 * the copilot path ever assigns one — claude/codex/agy get a fresh process every turn
 * and rely entirely on the replayed transcript for continuity.
 *
 * That remembered session is only valid to resume if copilot ALSO held the turn right
 * before this one. If the provider was switched away and back, the session predates the
 * switch and never saw what the other provider's turn covered — resuming it would
 * silently drop the middle of the conversation, invisible from both directions at once.
 */

const write = (dir: string, name: string, body: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
};

/**
 * A fake copilot CLI. Answers the `--help all` capability probe with plain text that
 * advertises nothing (so no session/stream/model flag ever gets appended), and on a
 * real query dumps the value that followed `-p` — the prompt copilot actually
 * received — to `out`.
 */
const writeCopilotCli = (dir: string, name: string, out: string): string =>
  write(dir, name, [
    'if [ "$1" = "--help" ]; then',
    '  printf "copilot"',
    '  exit 0',
    'fi',
    'prev=""',
    'prompt=""',
    'for a in "$@"; do',
    '  if [ "$prev" = "-p" ]; then prompt="$a"; fi',
    '  prev="$a"',
    'done',
    `printf '%s' "$prompt" > '${out}'`,
  ].join('\n'));

/** A fake native CLI (claude/codex/agy): dumps the last argv element — where
 * `buildNativeProviderCommand` places the prompt — to `out`. */
const writeNativeCli = (dir: string, name: string, out: string): string =>
  write(dir, name, `for a in "$@"; do last="$a"; done\nprintf '%s' "$last" > '${out}'`);

const maybe = process.platform === 'win32' ? describe.skip : describe;

const drain = async (gen: AsyncGenerator<unknown>): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _chunk of gen) { /* drain */ }
};

maybe('copilot session continuity across a provider switch', () => {
  let dir: string;
  let plugin: ObsidianCopilotPlugin;
  let service: CopilotBridgeService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-switch-'));
    plugin = {
      settings: { ...DEFAULT_SETTINGS, selectedProvider: 'copilot', providerCliPaths: {} },
      app: { vault: { adapter: { basePath: dir } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin;
    service = new CopilotBridgeService(plugin);
  });

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('starts a NEW session and replays the intervening claude turn after copilot -> claude -> copilot', async () => {
    const out1 = path.join(dir, 'out1.txt');
    plugin.settings.copilotCliPath = writeCopilotCli(dir, 'copilot1.sh', out1);
    await drain(service.query('첫 코파일럿 질문', undefined, undefined));
    const sessionAfterTurn1 = service.getSessionId();
    expect(sessionAfterTurn1).toBeTruthy();

    const historyAfterTurn1: ChatMessage[] = [
      { id: '1', role: 'user', content: '첫 코파일럿 질문', timestamp: 1 },
      { id: '2', role: 'assistant', content: '첫 코파일럿 답변', timestamp: 2 },
    ] as unknown as ChatMessage[];

    const out2 = path.join(dir, 'out2.txt');
    plugin.settings.selectedProvider = 'claude';
    plugin.settings.providerCliPaths.claude = writeNativeCli(dir, 'claude.sh', out2);
    await drain(service.query('클로드 질문', undefined, historyAfterTurn1));

    const historyAfterTurn2: ChatMessage[] = [
      ...historyAfterTurn1,
      { id: '3', role: 'user', content: '클로드 질문', timestamp: 3 },
      { id: '4', role: 'assistant', content: '클로드 답변', timestamp: 4 },
    ] as unknown as ChatMessage[];

    const out3 = path.join(dir, 'out3.txt');
    plugin.settings.selectedProvider = 'copilot';
    plugin.settings.copilotCliPath = writeCopilotCli(dir, 'copilot2.sh', out3);
    await drain(service.query('두번째 코파일럿 질문', undefined, historyAfterTurn2));

    const sessionAfterTurn3 = service.getSessionId();
    expect(sessionAfterTurn3).toBeTruthy();
    expect(sessionAfterTurn3).not.toBe(sessionAfterTurn1);

    const promptSeenByCopilot = fs.readFileSync(out3, 'utf8');
    expect(promptSeenByCopilot).toContain('클로드 질문');
    expect(promptSeenByCopilot).toContain('클로드 답변');
  });

  it('keeps the same session and does NOT replay the transcript across copilot -> copilot', async () => {
    const out1 = path.join(dir, 'out1.txt');
    plugin.settings.copilotCliPath = writeCopilotCli(dir, 'copilot1.sh', out1);
    await drain(service.query('첫 코파일럿 질문', undefined, undefined));
    const sessionAfterTurn1 = service.getSessionId();
    expect(sessionAfterTurn1).toBeTruthy();

    const historyAfterTurn1: ChatMessage[] = [
      { id: '1', role: 'user', content: '첫 코파일럿 질문', timestamp: 1 },
      { id: '2', role: 'assistant', content: '첫 코파일럿 답변', timestamp: 2 },
    ] as unknown as ChatMessage[];

    const out2 = path.join(dir, 'out2.txt');
    plugin.settings.copilotCliPath = writeCopilotCli(dir, 'copilot2.sh', out2);
    await drain(service.query('두번째 코파일럿 질문', undefined, historyAfterTurn1));

    expect(service.getSessionId()).toBe(sessionAfterTurn1);

    const promptSeenByCopilot = fs.readFileSync(out2, 'utf8');
    expect(promptSeenByCopilot).not.toContain('첫 코파일럿 질문');
    expect(promptSeenByCopilot).not.toContain('첫 코파일럿 답변');
    expect(promptSeenByCopilot).toContain('두번째 코파일럿 질문');
  });
});
