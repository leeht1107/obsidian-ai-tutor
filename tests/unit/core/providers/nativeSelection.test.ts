import {
  buildNativeProviderCommand,
  resolveNativeSelection,
} from '../../../../src/core/providers/providerRegistry';

/**
 * The question this file answers: when a student picks a provider, a model and an
 * effort in the chat toolbar, is that exactly what the CLI is invoked with?
 */
describe('chat toolbar picks reaching the CLI', () => {
  it('sends the model stored for the selected provider, not another provider\'s', () => {
    const settings = {
      selectedProvider: 'agy' as const,
      providerModels: { agy: 'gemini-3.8-flash-low', claude: 'opus', copilot: 'gpt-5' },
      providerEfforts: {},
    };
    const selection = resolveNativeSelection(settings);
    expect(selection).toEqual({ provider: 'agy', model: 'gemini-3.8-flash-low', effort: '' });
    expect(buildNativeProviderCommand(selection.provider, 'hello', selection.model, selection.effort).args)
      .toEqual(['--dangerously-skip-permissions', '--model', 'gemini-3.8-flash-low', '-p', 'hello']);
  });

  it('sends the effort stored for the selected provider', () => {
    const settings = {
      selectedProvider: 'claude' as const,
      providerModels: {},
      providerEfforts: { claude: 'high', codex: 'xhigh' },
    };
    const selection = resolveNativeSelection(settings);
    expect(selection).toEqual({ provider: 'claude', model: '', effort: 'high' });
    expect(buildNativeProviderCommand('claude', 'hi', '', 'high').args)
      .toEqual(['-p', '--effort', 'high', 'hi', '--output-format', 'stream-json', '--verbose']);
  });

  it('lets a per-request model override the stored one', () => {
    const selection = resolveNativeSelection(
      { selectedProvider: 'codex', providerModels: { codex: 'gpt-5.5' }, providerEfforts: {} },
      'gpt-5.6-terra'
    );
    expect(selection.model).toBe('gpt-5.6-terra');
  });

  it('carries nothing across when the selected provider has no stored pick', () => {
    const selection = resolveNativeSelection({
      selectedProvider: 'codex',
      providerModels: { claude: 'opus' },
      providerEfforts: { claude: 'high' },
    });
    expect(selection).toEqual({ provider: 'codex', model: '', effort: '' });
    expect(buildNativeProviderCommand('codex', 'hi', '', '').args).toEqual(['exec', '--skip-git-repo-check', '--json', 'hi']);
  });
});
