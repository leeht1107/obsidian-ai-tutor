import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CopilotBridgeService } from '@/core/agent/CopilotBridgeService';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import type ObsidianCopilotPlugin from '@/main';

const providers = ['claude', 'codex', 'agy'] as const;

describe('learning request permission boundary', () => {
  let dir: string;

  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-readonly-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function fixture(provider: string, captured: string): string {
    const script = path.join(dir, `${provider}.js`);
    const cli = process.platform === 'win32' ? path.join(dir, `${provider}.cmd`) : script;
    const code = [
      'const fs = require("fs");',
      `const provider = ${JSON.stringify(provider)};`,
      `const captured = ${JSON.stringify(captured)};`,
      'const args = process.argv.slice(2);',
      'if (provider === "copilot" && args[0] === "--help") { console.log("--allow-all-tools --available-tools --output-format json --no-ask-user"); process.exit(0); }',
      'fs.writeFileSync(captured, args.join("\\n"));',
      'if (provider === "copilot") { console.log(JSON.stringify({ type: "assistant.message_delta", data: { deltaContent: "ok" } })); console.log(JSON.stringify({ type: "result", exitCode: 0 })); }',
      'else if (provider === "agy") console.log(JSON.stringify({ status: "SUCCESS", response: "ok", denied_actions: [] }));',
      'else console.log(JSON.stringify({ delta: { text: "ok" } }));',
    ].join('\n');
    fs.writeFileSync(script, code);
    if (process.platform === 'win32') {
      fs.writeFileSync(cli, `@ECHO OFF\r\n"%_prog%" "%~dp0\\${provider}.js" %*\r\n`);
    } else {
      fs.writeFileSync(script, `#!/usr/bin/env node\n${code}`);
      fs.chmodSync(cli, 0o755);
    }
    return cli;
  }

  async function run(
    provider: 'claude' | 'codex' | 'agy' | 'copilot',
    pathSetting: 'modern' | 'legacy' = 'modern',
    acknowledged = true,
    enableWebSearch = true,
    requireWebSearchDisabled = false,
    readOnly = true,
    repeat = 1,
  ): Promise<{ args: string[]; notices: string[]; spawned: boolean }> {
    const captured = path.join(dir, `args-${provider}-${pathSetting}.txt`);
    if (fs.existsSync(captured)) fs.unlinkSync(captured);
    const cli = fixture(provider, captured);
    const notices: string[] = [];
    const service = new CopilotBridgeService({
      settings: {
        ...DEFAULT_SETTINGS,
        selectedProvider: provider,
        permissionMode: 'agent',
        blanketWriteAcknowledged: acknowledged ? [provider] : [],
        allowUnsafeAgyAgent: true,
        providerCliPaths: pathSetting === 'modern' ? { [provider]: cli } : {},
        copilotCliPath: pathSetting === 'legacy' ? cli : '',
      },
      app: { vault: { adapter: { basePath: dir } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin);
    service.onPermissionNotice = (notice) => notices.push(notice);

    for (let i = 0; i < repeat; i += 1) {
      for await (const chunk of service.query('learning prompt', undefined, undefined, {
        readOnly,
        enableWebSearch,
        requireWebSearchDisabled,
      })) { void chunk; }
    }
    const spawned = fs.existsSync(captured);
    return { args: spawned ? fs.readFileSync(captured, 'utf8').trim().split(/\r?\n/) : [], notices, spawned };
  }

  it.each(providers)('passes read-only flags on the actual %s request dispatch', async (provider) => {
    const { args } = await run(provider);
    expect(args).not.toContain('bypassPermissions');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('workspace-write');
    expect(args).not.toContain('--allow-all-tools');
    expect(args.includes('--disallowedTools')).toBe(provider === 'claude');
    expect(args.includes('Write,Edit,Bash')).toBe(provider === 'claude');
    expect(args.includes('read-only')).toBe(provider === 'codex');
    expect(args.includes('approval_policy="never"')).toBe(provider === 'codex');
  });

  it('uses the configured legacy Copilot CLI and preserves WebSearch while restricting tools', async () => {
    const { args } = await run('copilot', 'legacy');
    expect(args).not.toContain('--allow-all-tools');
    expect(args).toContain('--available-tools');
    expect(args).toContain('web_search');
  });

  it('does not request write consent for an explicitly read-only learning request', async () => {
    const { args, notices } = await run('claude', 'modern', false);
    expect(args).toContain('--disallowedTools');
    expect(notices).toEqual([]);
  });

  it('lets ordinary Agy chat run with Web off and explains that search remains available', async () => {
    const { args, notices, spawned } = await run('agy', 'modern', true, false, false, false);
    expect(spawned).toBe(true);
    expect(args).toContain('--output-format');
    expect(notices.join(' ')).toMatch(/Agy/);
    expect(notices.join(' ')).toMatch(/Web 검색/);
    expect(notices.join(' ')).toMatch(/계속 진행합니다/);
  });

  it.each([false, true])('continues Agy with Web available when a request requires Web disabled and global Web is %s', async (enableWebSearch) => {
    const { args, notices, spawned } = await run('agy', 'modern', true, enableWebSearch, true);
    expect(spawned).toBe(true);
    expect(args).toContain('--output-format');
    expect(notices.join(' ')).toMatch(/Web 검색/);
    expect(notices.join(' ')).toMatch(/계속 진행합니다/);
    expect(args.join('\n')).toContain('Use WebSearch strictly');
    expect(args.join('\n')).not.toContain('Web search is unavailable for this request.');
  });

  it('shows distinct Agy notices once each across consecutive requests', async () => {
    const { notices, spawned } = await run('agy', 'modern', false, false, false, false, 2);
    expect(spawned).toBe(true);
    expect(notices.filter((notice) => notice.includes('Web 검색'))).toHaveLength(1);
    expect(notices.filter((notice) => notice.includes('Ask/Agent'))).toHaveLength(1);
  });

  it('keeps Agy runnable when Web is on', async () => {
    const { args, spawned } = await run('agy', 'modern', true, true);
    expect(spawned).toBe(true);
    expect(args).toContain('--output-format');
  });

  it('passes the toolbar Web state into native Claude and Codex argv', async () => {
    const claudeOff = await run('claude', 'modern', true, false);
    expect(claudeOff.args).toContain('Write,Edit,Bash,WebSearch,WebFetch');
    const claudeOn = await run('claude', 'modern', true, true);
    const claudeDisallowedToolsIndex = claudeOn.args.indexOf('--disallowedTools');
    expect(claudeOn.args[claudeDisallowedToolsIndex + 1]).toBe('Write,Edit,Bash');
    expect(claudeOn.args).toContain('--tools');
    expect(claudeOn.args[claudeOn.args.indexOf('--tools') + 1]).toBe('default');
    expect(claudeOff.args).not.toContain('--tools');

    const codexOff = await run('codex', 'modern', true, false);
    expect(codexOff.args).toContain('web_search="disabled"');
    const codexOn = await run('codex', 'modern', true, true);
    expect(codexOn.args).not.toContain('web_search="disabled"');
  });
});
