import * as fs from 'fs';
import { TFile } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { SlashCommandManager } from '@/core/commands';
import type { SlashCommand } from '@/core/types';
import { parseSlashCommandContent } from '@/utils/slashCommand';

function createMockApp(files: Record<string, string>) {
  const fileEntries = Object.keys(files).map((filePath) => ({
    path: filePath,
    name: filePath.split('/').pop() || filePath,
    stat: { mtime: 1 },
  }));
  return {
    vault: {
      getAbstractFileByPath: jest.fn((p: string) => {
        if (!(p in files)) {
          return null;
        }
        return new (TFile as any)(p);
      }),
      getMarkdownFiles: jest.fn(() => fileEntries),
      read: jest.fn(async (file: TFile) => files[file.path] ?? ''),
    },
  } as any;
}

describe('SlashCommandManager', () => {
  describe('detectCommand', () => {
    it('should detect registered commands and parse args', () => {
      const app = createMockApp({});
      const manager = new SlashCommandManager(app, '/vault');

      const commands: SlashCommand[] = [
        { id: '1', name: 'test', content: 'Hello' },
        { id: '2', name: 'review-code', content: 'Hi' },
      ];
      manager.setCommands(commands);

      expect(manager.detectCommand('/test one two')).toEqual({ commandName: 'test', args: 'one two' });
      expect(manager.detectCommand('   /review-code  a   b ')).toEqual({ commandName: 'review-code', args: 'a   b' });
      expect(manager.detectCommand('/unknown arg')).toBeNull();
    });
  });

  describe('parseSlashCommandContent', () => {
    it('should parse frontmatter with CRLF and multiline arrays', () => {
      const content = [
        '---\r',
        'description: "Desc"\r',
        "argument-hint: '<file>'\r",
        'model: sonnet\r',
        'allowed-tools:\r',
        '  - Read\r',
        '  - "Write"\r',
        '---\r',
        '\r',
        'Hello',
      ].join('\n');

      const parsed = parseSlashCommandContent(content);
      expect(parsed.description).toBe('Desc');
      expect(parsed.argumentHint).toBe('<file>');
      expect(parsed.model).toBe('sonnet');
      expect(parsed.allowedTools).toEqual(['Read', 'Write']);
      expect(parsed.promptContent.trim()).toBe('Hello');
    });
  });

  describe('expandCommand', () => {
    it('should replace $ARGUMENTS and positional args', async () => {
      const app = createMockApp({});
      const manager = new SlashCommandManager(app, '/vault');

      const command: SlashCommand = {
        id: '1',
        name: 'args',
        content: 'All: $ARGUMENTS\nFirst: $1\nSecond: $2\nThird: $3',
      };

      const result = await manager.expandCommand(command, 'one "two words"');
      expect(result.expandedPrompt).toBe('All: one "two words"\nFirst: one\nSecond: two words\nThird:');
    });

    it('should resolve @file references with boundary rules', async () => {
      const app = createMockApp({
        'foo.md': 'FOO',
        'bar.md': 'BAR',
      });
      const manager = new SlashCommandManager(app, '/vault');

      const command: SlashCommand = {
        id: '1',
        name: 'files',
        content: [
          'Email: user@example.com',
          'Ref: @foo.md',
          'Paren: (@bar.md)',
          'WordPrefix: foo@baz.md',
        ].join('\n'),
      };

      const result = await manager.expandCommand(command, '');
      expect(result.expandedPrompt).toContain('Email: user@example.com');
      expect(result.expandedPrompt).toContain('Ref: FOO');
      expect(result.expandedPrompt).toContain('Paren: (BAR)');
      expect(result.expandedPrompt).toContain('WordPrefix: foo@baz.md');
    });

    it('should resolve basename-only @file references when the vault match is unique', async () => {
      const app = createMockApp({
        'nested/teachers.md': 'TEACHERS',
      });
      const manager = new SlashCommandManager(app, '/vault');

      const command: SlashCommand = {
        id: '1',
        name: 'files',
        content: 'Ref: @teachers.md',
      };

      const result = await manager.expandCommand(command, '');
      expect(result.expandedPrompt).toContain('Ref: TEACHERS');
    });

    it('should not execute inline bash from referenced file content', async () => {
      const app = createMockApp({
        'foo.md': '!`echo injected`',
      });

      const bashRunner = jest.fn(async () => 'SHOULD_NOT_RUN');
      const manager = new SlashCommandManager(app, '/vault', { bashRunner });

      const command: SlashCommand = {
        id: '1',
        name: 'file-only',
        content: '@foo.md',
      };

      const result = await manager.expandCommand(command, '', { bash: { enabled: true } });
      expect(result.expandedPrompt).toBe('!`echo injected`');
      expect(bashRunner).not.toHaveBeenCalled();
    });

    it('should block inline bash before execution', async () => {
      const app = createMockApp({});
      const bashRunner = jest.fn(async () => 'OUT');
      const manager = new SlashCommandManager(app, '/vault', { bashRunner });

      const command: SlashCommand = {
        id: '1',
        name: 'blocked',
        content: '!`rm -rf /`',
      };

      const result = await manager.expandCommand(command, '', {
        bash: {
          enabled: true,
          shouldBlockCommand: () => true,
        },
      });

      expect(result.expandedPrompt).toBe('[Blocked]');
      expect(result.errors.some((e) => e.includes('blocked by blocklist'))).toBe(true);
      expect(bashRunner).not.toHaveBeenCalled();
    });

    it('never executes or requests approval when disabled (ASK/PLAN mode: enabled=false)', async () => {
      // ASK/PLAN callers (InputController, InlineEditModal) compute `enabled` from
      // `permissionMode === 'agent'` and no longer pass `requestApproval` at all — this
      // pins the resulting contract at the SlashCommandManager level: disabled always
      // wins, so a stray approval callback is never reachable.
      const app = createMockApp({});
      const bashRunner = jest.fn(async () => 'OUT');
      const requestApproval = jest.fn(async () => true);
      const manager = new SlashCommandManager(app, '/vault', { bashRunner });

      const command: SlashCommand = {
        id: '1',
        name: 'ask-mode',
        content: '!`echo hi`',
      };

      const result = await manager.expandCommand(command, '', {
        bash: { enabled: false, requestApproval },
      });

      expect(result.expandedPrompt).toBe('[Inline bash disabled]');
      expect(requestApproval).not.toHaveBeenCalled();
      expect(bashRunner).not.toHaveBeenCalled();
    });

    it('should require approval for inline bash when configured', async () => {
      const app = createMockApp({});
      const bashRunner = jest.fn(async () => 'OUT');
      const manager = new SlashCommandManager(app, '/vault', { bashRunner });

      const command: SlashCommand = {
        id: '1',
        name: 'approve',
        content: '!`echo hi`',
      };

      const denied = await manager.expandCommand(command, '', {
        bash: {
          enabled: true,
          requestApproval: async () => false,
        },
      });
      expect(denied.expandedPrompt).toBe('[Denied]');
      expect(bashRunner).not.toHaveBeenCalled();

      const allowed = await manager.expandCommand(command, '', {
        bash: {
          enabled: true,
          requestApproval: async () => true,
        },
      });
      expect(allowed.expandedPrompt).toBe('OUT');
      expect(bashRunner).toHaveBeenCalled();
    });

    it('runs commands that merely resemble backgrounding syntax like any other command', async () => {
      const app = createMockApp({});
      const bashRunner = jest.fn(async () => 'OUT');
      const manager = new SlashCommandManager(app, '/vault', { bashRunner });

      const cases = [
        'echo a && echo b',
        "grep 'x & y' file",
        'echo "a & b"',
        'echo hi 2>&1',
        'echo hi >&2',
        'echo hi &>file',
        'echo nohup',
      ];

      for (const cmd of cases) {
        bashRunner.mockClear();
        const command: SlashCommand = {
          id: '1',
          name: 'ordinary',
          content: `!\`${cmd}\``,
        };

        const result = await manager.expandCommand(command, '', {
          bash: { enabled: true },
        });

        expect(result.expandedPrompt).toBe('OUT');
        expect(bashRunner).toHaveBeenCalledWith(cmd, '/vault');
      }
    });
  });

  // These use the real default bash runner (no injected mock) to verify the
  // process-group teardown actually reaps a backgrounded/detached child once
  // the awaited command settles — the property that replaced the old textual
  // scanner (see git history: isUntrackableBackgroundCommand et al.).
  const maybe = process.platform === 'win32' ? describe.skip : describe;

  maybe('defaultBashRunner: process-group teardown of backgrounded children', () => {
    let dir: string;
    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-bash-'));
    });
    afterAll(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    async function expandBash(content: string): Promise<{ expandedPrompt: string; errors: string[] }> {
      const app = createMockApp({});
      const manager = new SlashCommandManager(app, dir);
      const command: SlashCommand = { id: '1', name: 'real', content: `!\`${content}\`` };
      return manager.expandCommand(command, '', { bash: { enabled: true } });
    }

    it('reaps a simple `&`-backgrounded child with its group', async () => {
      // `>/dev/null 2>&1` detaches the background child's stdio from the
      // wrapper's own stdout/stderr pipes. Without it, Node's `close` event
      // (which waits for every stdio holder to release the pipe, not just
      // the awaited process) would already block until the child finishes —
      // i.e. it would never have been a bypass in the first place.
      const proofFile = path.join(dir, 'delayed-proof-simple.txt');
      await expandBash(`sh -c 'sleep 0.3; printf x >> ${proofFile}' >/dev/null 2>&1 &`);

      await new Promise((r) => setTimeout(r, 600));
      expect(fs.existsSync(proofFile)).toBe(false);
    });

    it("reaps the reviewer's nested nohup payload that defeated the old textual scanner", async () => {
      const proofFile = path.join(dir, 'delayed-proof.md');
      // Everything the old scanner looked for (`&`, `nohup`) is inside the
      // outer command's single quotes, so it only ever saw the leading `sh`.
      await expandBash(`sh -c 'nohup sh -c "sleep 0.3; printf x >> ${proofFile}" >/dev/null 2>&1 &'`);

      await new Promise((r) => setTimeout(r, 600));
      expect(fs.existsSync(proofFile)).toBe(false);
    });
  });
});
