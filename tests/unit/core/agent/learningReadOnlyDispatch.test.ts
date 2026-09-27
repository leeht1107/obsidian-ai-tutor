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
  ): Promise<{ args: string[]; notices: string[] }> {
    const captured = path.join(dir, `args-${provider}-${pathSetting}.txt`);
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

    for await (const chunk of service.query('learning prompt', undefined, undefined, {
      readOnly: true,
      enableWebSearch: true,
    })) { void chunk; }
    return { args: fs.readFileSync(captured, 'utf8').trim().split(/\r?\n/), notices };
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
});
