import {
  allowsEffortWithModel,
  buildNativeProviderCommand,
  getProviderEffortLevels,
  getStaticProviderModels,
  migrateProviderModels,
  parseAgyModels,
  parseCodexModels,
  supportsEffortSelection,
} from '../../../../src/core/providers/providerRegistry';
import { toToolbarSettings } from '../../../../src/ui/components/InputToolbar';

/**
 * Capability regressions for the direct-CLI provider controls.
 *
 * Every expectation below is pinned to output this machine's installed CLIs
 * actually produced (see the handoff's verification block), not to a label:
 *   claude --effort bogus -> "Valid values: low, medium, high, xhigh, max"
 *   agy    --effort bogus -> 'invalid --effort "bogus" (valid: low, medium, high)'
 *   codex  -c model_reasoning_effort=bogusvalue -> API reasoning.effort enum error
 */
describe('provider model + effort capability', () => {
  describe('effort reaches the selected CLI in its own dialect', () => {
    it('passes claude effort with the documented --effort flag', () => {
      expect(buildNativeProviderCommand('claude', 'hello', 'opus', 'high').args).toEqual([
        '-p', '--model', 'opus', '--effort', 'high', 'hello', '--output-format', 'stream-json', '--verbose',
      ]);
    });

    it('passes codex effort as a quoted model_reasoning_effort config override', () => {
      expect(buildNativeProviderCommand('codex', 'hello', 'gpt-5.6-terra', 'xhigh').args).toEqual([
        'exec', '--skip-git-repo-check', '--model', 'gpt-5.6-terra', '-c', 'model_reasoning_effort="xhigh"', '--json', 'hello',
      ]);
    });

    it('passes agy effort with the documented --effort flag when no model is pinned', () => {
      // With a model, agy rejects the pair — see the mutual-exclusion suite below.
      expect(buildNativeProviderCommand('agy', 'hello', '', 'medium').args).toEqual([
        '--dangerously-skip-permissions',
        '--effort', 'medium', '-p', 'hello',
      ]);
    });

    it('omits effort entirely when none is selected', () => {
      expect(buildNativeProviderCommand('claude', 'hello', 'opus').args).not.toContain('--effort');
      expect(buildNativeProviderCommand('codex', 'hello', 'gpt-5.5').args).not.toContain('-c');
      expect(buildNativeProviderCommand('agy', 'hello', 'x').args).not.toContain('--effort');
    });

    it('never emits an effort value the installed CLI would reject', () => {
      // agy's CLI enumerates only low|medium|high; xhigh must not reach it.
      expect(buildNativeProviderCommand('agy', 'hello', '', 'xhigh').args).not.toContain('--effort');
      expect(buildNativeProviderCommand('claude', 'hello', 'opus', 'bogus').args).not.toContain('--effort');
      expect(buildNativeProviderCommand('copilot', 'hello', '', 'high').args).toEqual(['-p', 'hello']);
    });
  });

  describe('advertised capability matches the installed CLI', () => {
    it('exposes effort only for providers whose CLI can honor it', () => {
      expect(supportsEffortSelection('claude')).toBe(true);
      expect(supportsEffortSelection('codex')).toBe(true);
      expect(supportsEffortSelection('agy')).toBe(true);
      expect(supportsEffortSelection('copilot')).toBe(false);
    });

    it('advertises exactly the effort levels each CLI validated', () => {
      expect(getProviderEffortLevels('claude')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(getProviderEffortLevels('agy')).toEqual(['low', 'medium', 'high']);
      // codex is the one whose list is a deliberate subset of a wider API enum
      // (none/minimal are omitted, and the catalog's `ultra` is not accepted), so pin it.
      expect(getProviderEffortLevels('codex')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
      expect(getProviderEffortLevels('copilot')).toEqual([]);
    });
  });

  describe('static model catalog only claims what is verified', () => {
    it('offers the claude aliases the CLI accepted and no others', () => {
      expect(getStaticProviderModels('claude').map((m) => m.id)).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
    });

    it('drops the stale hardcoded codex ids in favour of local discovery', () => {
      const codexIds = getStaticProviderModels('codex').map((m) => m.id);
      expect(codexIds).not.toContain('o3');
      expect(codexIds).toEqual([]);
      expect(getStaticProviderModels('agy')).toEqual([]);
    });
  });

  describe('local discovery parses what the CLIs actually print', () => {
    it('reads tab-separated `agy models` rows instead of discarding them', () => {
      const stdout = [
        'Fetching available models...',
        'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
        'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
        '',
      ].join('\n');
      expect(parseAgyModels(stdout)).toEqual([
        { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', efforts: [] },
        { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)', efforts: [] },
      ]);
    });

    it('reads the codex catalog and keeps each model to its own reasoning levels', () => {
      const stdout = JSON.stringify({
        models: [
          { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', supported_reasoning_levels: [{ effort: 'low' }] },
          { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'ultra' }] },
          { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', supported_reasoning_levels: [{ effort: 'medium' }, { effort: 'xhigh' }] },
        ],
      });
      expect(parseCodexModels(stdout)).toEqual([
        { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', efforts: ['low', 'medium'] },
        { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['medium', 'xhigh'] },
      ]);
    });

    it('returns nothing rather than guessing when discovery output is unusable', () => {
      expect(parseCodexModels('not json')).toEqual([]);
      expect(parseAgyModels('Fetching available models...\n')).toEqual([]);
    });

    it('never promotes a bare status or footer word to a dispatchable model', () => {
      // A single-token line has no tab, so it is not a `<id>\t<label>` row.
      expect(parseAgyModels(['Done', 'Models:', 'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)'].join('\n')))
        .toEqual([{ id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)', efforts: [] }]);
    });
  });
});

/**
 * The toolbar reads settings through a hand-written projection. A provider-scoped key that
 * is stored and dispatched but missing from the projection makes the control render as
 * permanently unset — the user clicks a level, it is saved and sent to the CLI, and the UI
 * never changes. That is the failure this suite pins.
 */
describe('toolbar settings projection', () => {
  const stored = {
    model: 'auto',
    selectedProvider: 'claude' as const,
    thinkingBudget: 'off' as const,
    permissionMode: 'agent' as const,
    providerModels: { claude: 'opus' },
    providerEfforts: { claude: 'high' },
  };

  it('carries every provider-scoped key through to the toolbar', () => {
    const projected = toToolbarSettings(stored);
    expect(projected.providerModels).toEqual({ claude: 'opus' });
    expect(projected.providerEfforts).toEqual({ claude: 'high' });
  });

  it('projects each key the toolbar reads', () => {
    const projected = toToolbarSettings(stored);
    for (const key of ['model', 'selectedProvider', 'thinkingBudget', 'permissionMode', 'providerModels', 'providerEfforts'] as const) {
      expect(projected).toHaveProperty(key);
    }
  });
});

/**
 * Removing an id from the menu does not remove it from a user's data.json. 0.1.7 shipped
 * codex: ['gpt-5.4', 'o3']; anyone who picked `o3` would otherwise keep dispatching
 * `--model o3` on every send, with no way to un-pick it since it is no longer listed.
 */
describe('retired provider model migration', () => {
  it('clears an id the installed CLI no longer lists', () => {
    const models: Record<string, string> = { codex: 'o3' };
    migrateProviderModels(models);
    expect(models.codex).toBeUndefined();
  });

  it('keeps ids that are still in the catalog', () => {
    const models: Record<string, string> = { codex: 'gpt-5.4', claude: 'opus', agy: 'gemini-3.8-flash-low' };
    migrateProviderModels(models);
    expect(models).toEqual({ codex: 'gpt-5.4', claude: 'opus', agy: 'gemini-3.8-flash-low' });
  });

  it('tolerates absent or empty settings', () => {
    expect(() => migrateProviderModels(undefined)).not.toThrow();
    const empty: Record<string, string> = {};
    migrateProviderModels(empty);
    expect(empty).toEqual({});
  });
});

/**
 * agy bakes the reasoning level into the model id (`gemini-3.8-flash-high`), so the two
 * flags are mutually exclusive. Its CLI rejects the combination outright:
 *   --model gemini-3.8-flash-high --effort low
 *     -> 'invalid model selection ...: --model gemini-3.8-flash-high conflicts with --effort=low'
 *   --model claude-sonnet-4-6 --effort high
 *     -> 'invalid model selection ...: --effort is not supported for model "claude-sonnet-4-6"'
 * Either flag alone works. claude and codex accept both together.
 */
describe('providers where model and effort cannot be combined', () => {
  it('knows agy cannot take both, and that claude and codex can', () => {
    expect(allowsEffortWithModel('agy')).toBe(false);
    expect(allowsEffortWithModel('claude')).toBe(true);
    expect(allowsEffortWithModel('codex')).toBe(true);
  });

  it('never sends agy a model and an effort in the same invocation', () => {
    const args = buildNativeProviderCommand('agy', 'hello', 'gemini-3.8-flash-high', 'low').args;
    expect(args).toEqual(['--dangerously-skip-permissions', '--model', 'gemini-3.8-flash-high', '-p', 'hello']);
    expect(args).not.toContain('--effort');
  });

  it('still lets agy use effort alone when no model is pinned', () => {
    expect(buildNativeProviderCommand('agy', 'hello', '', 'high').args).toEqual(['--dangerously-skip-permissions', '--effort', 'high', '-p', 'hello']);
  });

  it('leaves claude and codex free to combine the two', () => {
    expect(buildNativeProviderCommand('claude', 'hello', 'opus', 'high').args).toContain('--effort');
    expect(buildNativeProviderCommand('codex', 'hello', 'gpt-5.6-terra', 'high').args).toContain('-c');
  });

  it('does not advertise per-model effort for agy, whose level is part of the id', () => {
    const parsed = parseAgyModels('gemini-3.8-flash-high\tGemini 3.8 Flash (High)');
    expect(parsed).toEqual([{ id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', efforts: [] }]);
  });
});
