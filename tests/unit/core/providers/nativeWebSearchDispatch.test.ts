import { resolveCopilotAllowedTools } from '@/core/agent/CopilotBridgeService';
import { buildNativeProviderCommand } from '@/core/providers/providerRegistry';

describe('native provider Web dispatch', () => {
  it('disables WebSearch/WebFetch for Claude when toolbar Web is off', () => {
    const args = buildNativeProviderCommand('claude', 'prompt', '', '', 'ask', false, false).args;
    expect(args).toContain('Write,Edit,Bash,WebSearch,WebFetch');
  });

  it('preserves WebSearch for Claude when toolbar Web is on', () => {
    const args = buildNativeProviderCommand('claude', 'prompt', '', '', 'ask', false, true).args;
    expect(args).toContain('Write,Edit,Bash');
    expect(args.join(' ')).not.toMatch(/WebSearch|WebFetch/);
  });

  it('disables Codex web_search per request when toolbar Web is off', () => {
    const args = buildNativeProviderCommand('codex', 'prompt', '', '', 'ask', false, false).args;
    expect(args).toContain('web_search="disabled"');
  });

  it('leaves Codex Web enabled by preserving its configured mode when toolbar Web is on', () => {
    const args = buildNativeProviderCommand('codex', 'prompt', '', '', 'ask', false, true).args;
    expect(args).not.toContain('web_search="disabled"');
  });

  it('keeps Copilot Web filtering tied to the toolbar state', () => {
    expect(resolveCopilotAllowedTools('ask', undefined, false, true)).toContain('web_search');
    expect(resolveCopilotAllowedTools('ask', undefined, false, false)).not.toEqual(
      expect.arrayContaining(['web_search', 'web_fetch'])
    );
  });
});
