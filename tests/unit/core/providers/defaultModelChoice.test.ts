/**
 * Where the settings tab's default-model choice is stored.
 *
 * The row used to list the bundled Copilot catalog whatever provider was
 * selected, and wrote every choice to settings.model. Native providers dispatch
 * from settings.providerModels[provider], so a student who picked a model after
 * choosing Claude changed nothing at all — and a Copilot id handed to `claude
 * --model` is rejected outright. Both reviewers put this first.
 */
import { defaultModelSource, storeDefaultModel } from '@/core/providers/providerRegistry';
import { DEFAULT_SETTINGS } from '@/core/types/settings';

describe('storeDefaultModel', () => {
  it('keeps copilot on the bundled catalog field the request path reads', () => {
    const settings = { ...DEFAULT_SETTINGS, model: 'gpt-4.1', providerModels: {} };
    storeDefaultModel(settings, 'copilot', 'gpt-5-mini');
    expect(settings.model).toBe('gpt-5-mini');
    expect(settings.providerModels).toEqual({});
  });

  it('writes a native provider to its own slot, not over copilot', () => {
    const settings = { ...DEFAULT_SETTINGS, model: 'gpt-4.1', providerModels: {} };
    storeDefaultModel(settings, 'claude', 'opus');
    expect(settings.providerModels).toEqual({ claude: 'opus' });
    expect(settings.model).toBe('gpt-4.1');
  });

  it('keeps the other providers choices', () => {
    const settings = { ...DEFAULT_SETTINGS, providerModels: { claude: 'opus' } };
    storeDefaultModel(settings, 'agy', 'gemini-3.8-flash-high');
    expect(settings.providerModels).toEqual({ claude: 'opus', agy: 'gemini-3.8-flash-high' });
  });

  it('clears a slot rather than storing an empty id, so the CLI default applies', () => {
    const settings = { ...DEFAULT_SETTINGS, providerModels: { claude: 'opus' } };
    storeDefaultModel(settings, 'claude', '');
    expect(settings.providerModels).toEqual({});
  });
});

describe('defaultModelSource', () => {
  it('knows which providers can be listed without spawning anything', () => {
    expect(defaultModelSource('copilot')).toBe('copilot-catalog');
    // claude ships a fixed list of aliases, so the row can be drawn at once.
    expect(defaultModelSource('claude')).toBe('bundled');
    // codex and agy answer only their own CLI, which costs a process — so the
    // settings row must offer that as a click, never do it on open.
    expect(defaultModelSource('codex')).toBe('ask-cli');
    expect(defaultModelSource('agy')).toBe('ask-cli');
  });
});
