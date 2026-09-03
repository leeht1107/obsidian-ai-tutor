import * as fs from 'fs';
import * as path from 'path';

import { COPILOT_ICON_SVG } from '../../../../src/assets/icon';
import { createProviderSelector } from '../../../../src/features/chat/ObsidianCopilotView';
import { getModelSelectorLabel } from '../../../../src/ui/components/InputToolbar';

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

  it('refreshes provider-dependent model UI immediately after persistence', async () => {
    let refreshed = 0;
    const select = {
      value: 'copilot',
      createEl: jest.fn().mockReturnValue({}),
      addEventListener: (_event: string, handler: () => Promise<void>) => { void handler(); },
    };
    const label = { createSpan: jest.fn(), createEl: jest.fn().mockReturnValue(select) };
    const plugin = { settings: { selectedProvider: 'copilot' as const }, saveSettings: jest.fn().mockResolvedValue(undefined) };
    createProviderSelector({ createEl: jest.fn().mockReturnValue(label) } as any, plugin as any, () => { refreshed += 1; });
    await Promise.resolve();
    expect(refreshed).toBe(1);
  });

  it('never presents a Copilot model as active for native providers', () => {
    expect(getModelSelectorLabel('copilot', 'gpt-5.4')).toBe('gpt-5.4');
    expect(getModelSelectorLabel('claude', 'gpt-5.4')).toBe('Native default');
    expect(getModelSelectorLabel('codex', 'claude-opus-4.8')).toBe('Native default');
    expect(getModelSelectorLabel('agy', 'gpt-5.5')).toBe('Native default');
  });
});

describe('native tutor icon', () => {
  it('uses an accessible SVG without the old embedded raster artwork', () => {
    expect(COPILOT_ICON_SVG).toContain('aria-label="Obsidian AI Tutor"');
    expect(COPILOT_ICON_SVG).toContain('<path');
    expect(COPILOT_ICON_SVG).not.toContain('<image');
  });

  it('ships the registered compass SVG in the built plugin asset', () => {
    const builtPlugin = fs.readFileSync(path.resolve(__dirname, '../../../../main.js'), 'utf8');
    expect(builtPlugin).toContain('Obsidian AI Tutor');
    expect(builtPlugin).toContain('#7c3aed');
  });
});
