import { COPILOT_ICON_SVG } from '../../../../src/assets/icon';
import { createProviderSelector } from '../../../../src/features/chat/ObsidianCopilotView';

describe('chat provider selector', () => {
  it('renders every static provider and persists the next selection', async () => {
    const options: Array<{ value: string; text: string }> = [];
    let onChange: (() => Promise<void>) | undefined;
    const select = {
      value: 'copilot',
      createEl: (_tag: string, option: { value: string; text: string }) => {
        options.push(option);
        return option;
      },
      addEventListener: (_event: string, handler: () => Promise<void>) => {
        onChange = handler;
      },
    };
    const label = {
      createSpan: jest.fn(),
      createEl: jest.fn().mockReturnValue(select),
    };
    const toolbar = { createEl: jest.fn().mockReturnValue(label) };
    const plugin = {
      settings: { selectedProvider: 'copilot' as const },
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };

    const result = createProviderSelector(toolbar as any, plugin as any);
    result.value = 'codex';
    await onChange?.();

    expect(options.map((option) => option.value)).toEqual(['copilot', 'claude', 'codex', 'agy']);
    expect(plugin.settings.selectedProvider).toBe('codex');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
  });
});

describe('native tutor icon', () => {
  it('uses an accessible SVG without the old embedded raster artwork', () => {
    expect(COPILOT_ICON_SVG).toContain('aria-label="Obsidian AI Tutor"');
    expect(COPILOT_ICON_SVG).toContain('<path');
    expect(COPILOT_ICON_SVG).not.toContain('<image');
  });
});
