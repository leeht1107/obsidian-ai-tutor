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
    const cli = path.join(dir, `${provider}.sh`);
    const code = provider === 'copilot'
      ? `if [ "$1" = "--help" ]; then printf '%s\\n' '--allow-all-tools --available-tools --output-format json --no-ask-user'; exit 0; fi\nprintf '%s\\n' "$@" > '${captured}'\nprintf '%s\\n' '{"type":"assistant.message_delta","data":{"deltaContent":"ok"}}' '{"type":"result","exitCode":0}'\n`
      : `printf '%s\\n' "$@" > '${captured}'\nprintf '%s\\n' '${provider === 'agy' ? '{"status":"SUCCESS","response":"ok","denied_actions":[]}' : '{"delta":{"text":"ok"}}'}'\n`;
    fs.writeFileSync(cli, `#!/bin/sh\n${code}`);
    fs.chmodSync(cli, 0o755);
    return cli;
  }

  async function run(provider: 'claude' | 'codex' | 'agy' | 'copilot', pathSetting: 'modern' | 'legacy' = 'modern'): Promise<string[]> {
    const captured = path.join(dir, `args-${provider}-${pathSetting}.txt`);
    const cli = fixture(provider, captured);
    const service = new CopilotBridgeService({
      settings: {
        ...DEFAULT_SETTINGS,
        selectedProvider: provider,
        permissionMode: 'agent',
        blanketWriteAcknowledged: [provider],
        allowUnsafeAgyAgent: true,
        providerCliPaths: pathSetting === 'modern' ? { [provider]: cli } : {},
        copilotCliPath: pathSetting === 'legacy' ? cli : '',
      },
      app: { vault: { adapter: { basePath: dir } } },
      getActiveEnvironmentVariables: () => '',
    } as unknown as ObsidianCopilotPlugin);

    for await (const chunk of service.query('learning prompt', undefined, undefined, {
      readOnly: true,
      enableWebSearch: true,
    })) { void chunk; }
    return fs.readFileSync(captured, 'utf8').trim().split(/\r?\n/);
  }

  it.each(providers)('passes read-only flags on the actual %s request dispatch', async (provider) => {
    const args = await run(provider);
    expect(args).not.toContain('bypassPermissions');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('workspace-write');
    expect(args).not.toContain('--allow-all-tools');
    expect(args.includes('read-only')).toBe(provider === 'codex');
    expect(args.includes('approval_policy="never"')).toBe(provider === 'codex');
  });

  it('uses the configured legacy Copilot CLI and preserves WebSearch while restricting tools', async () => {
    const args = await run('copilot', 'legacy');
    expect(args).not.toContain('--allow-all-tools');
    expect(args).toContain('--available-tools');
    expect(args).toContain('web_search');
  });
});
