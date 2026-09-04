import * as fs from 'fs';
import * as path from 'path';

import { COPILOT_ICON_SVG } from '../../../../src/assets/icon';
import * as providerRegistry from '../../../../src/core/providers/providerRegistry';
import { getProviderDescriptor } from '../../../../src/core/providers/providerRegistry';
import { PROVIDER_MARKS } from '../../../../src/features/chat/constants';
import { createProviderSelector } from '../../../../src/features/chat/ObsidianCopilotView';
import { getModelSelectorLabel, ThinkingBudgetSelector } from '../../../../src/ui/components/InputToolbar';

describe('chat provider selector', () => {
  const makeElement = (): any => {
    const element: any = {
      children: [],
      listeners: {},
      createDiv: jest.fn().mockImplementation((options: any) => {
        const child = makeElement();
        child.elementOptions = options;
        element.children.push(child);
        return child;
      }),
      createSpan: jest.fn().mockImplementation((options: any) => {
        const child = makeElement();
        child.elementOptions = options;
        element.children.push(child);
        return child;
      }),
      createEl: jest.fn().mockImplementation((_tag: string, options: any) => {
        const child = makeElement();
        child.elementOptions = options;
        element.children.push(child);
        return child;
      }),
    };
    Object.defineProperty(element, 'firstElementChild', {
      get: () => element.children[0] ?? null,
    });
    element.insertBefore = jest.fn().mockImplementation((child: any, before: any) => {
      const currentIndex = element.children.indexOf(child);
      if (currentIndex >= 0) element.children.splice(currentIndex, 1);
      const beforeIndex = element.children.indexOf(before);
      element.children.splice(beforeIndex >= 0 ? beforeIndex : element.children.length, 0, child);
      return child;
    });
    element.addEventListener = jest.fn().mockImplementation((event: string, handler: () => void) => {
      element.listeners[event] = handler;
    });
    element.emit = (event: string) => element.listeners[event]?.({ stopPropagation: jest.fn() });
    Object.assign(element, {
    setAttribute: jest.fn(),
    removeAttribute: jest.fn(),
    empty: jest.fn(),
    hasClass: jest.fn().mockReturnValue(false),
    addClass: jest.fn(),
    removeClass: jest.fn(),
    setText: jest.fn(),
    contains: jest.fn().mockReturnValue(false),
    classList: { toggle: jest.fn() },
    style: {},
    });
    return element;
  };

  it('renders every static provider and persists the next selection', async () => {
    const toolbar = makeElement();
    const plugin = {
      settings: { selectedProvider: 'copilot' as const },
      saveSettings: jest.fn().mockResolvedValue(undefined),
    };

    const result = createProviderSelector(toolbar as any, plugin as any);
    expect(result).toBeTruthy();
    expect(toolbar.createDiv).toHaveBeenCalledWith({ cls: 'ocop-provider-selector' });
  });

  it('refreshes provider-dependent model UI immediately after persistence', async () => {
    let refreshed = 0;
    const plugin = { settings: { selectedProvider: 'copilot' as const }, saveSettings: jest.fn().mockResolvedValue(undefined) };
    const toolbar = makeElement();
    createProviderSelector(toolbar as any, plugin as any, () => { refreshed += 1; });
    expect(refreshed).toBe(0);
  });

  it('places the provider selector before an existing model selector', () => {
    const toolbar = makeElement();
    const modelSelector = makeElement();
    toolbar.children.push(modelSelector);

    const providerSelector = createProviderSelector(toolbar, { settings: { selectedProvider: 'copilot' }, saveSettings: jest.fn() } as any);

    expect(toolbar.children[0]).toBe(providerSelector);
    expect(toolbar.children[1]).toBe(modelSelector);
  });

  it('registers outside-click dismissal through the owning view lifecycle', () => {
    const registerDocumentClick = jest.fn();
    createProviderSelector(makeElement(), { settings: { selectedProvider: 'copilot' }, saveSettings: jest.fn() } as any, undefined, registerDocumentClick);
    expect(registerDocumentClick).toHaveBeenCalledTimes(1);
  });

  it('reuses one setup hint when an unavailable provider is clicked repeatedly', () => {
    const findPath = jest.spyOn(providerRegistry, 'findProviderCliPath').mockReturnValue(null);
    const toolbar = makeElement();
    createProviderSelector(toolbar, { settings: { selectedProvider: 'copilot' }, saveSettings: jest.fn() } as any);
    const container = toolbar.children[0];
    const popover = container.children[1];
    const unavailableOption = popover.children.filter((child: any) => child.elementOptions?.cls === 'ocop-provider-option').at(-1);
    const hintsBefore = popover.createDiv.mock.calls.length;
    unavailableOption.emit('click');
    unavailableOption.emit('click');
    expect(popover.createDiv.mock.calls.filter((call: any[]) => call[0]?.cls === 'ocop-provider-setup-hint')).toHaveLength(1);
    expect(popover.createDiv.mock.calls.length).toBe(hintsBefore + 1);
    findPath.mockRestore();
  });

  it('selects agy when PATH or the configured provider CLI path resolves it', async () => {
    const findPath = jest.spyOn(providerRegistry, 'findProviderCliPath').mockImplementation((id, customPath = '') => {
      if (id === 'agy' && (customPath === '/configured/agy' || customPath === '')) return customPath || '/path/agy';
      return null;
    });
    const plugin = { settings: { selectedProvider: 'copilot' as const, providerCliPaths: { agy: '/configured/agy' } }, saveSettings: jest.fn().mockResolvedValue(undefined) };
    const toolbar = makeElement();
    createProviderSelector(toolbar, plugin as any);
    const popover = toolbar.children[0].children[1];
    const agyOption = popover.children.filter((child: any) => child.elementOptions?.cls === 'ocop-provider-option')[3];
    expect(findPath).toHaveBeenCalledWith('agy', '/configured/agy');
    await agyOption.listeners.click({ stopPropagation: jest.fn() });
    expect(plugin.settings.selectedProvider).toBe('agy');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

    const pathPlugin = { settings: { selectedProvider: 'copilot' as const }, saveSettings: jest.fn().mockResolvedValue(undefined) };
    const pathToolbar = makeElement();
    createProviderSelector(pathToolbar, pathPlugin as any);
    const pathPopover = pathToolbar.children[0].children[1];
    const pathAgyOption = pathPopover.children.filter((child: any) => child.elementOptions?.cls === 'ocop-provider-option')[3];
    expect(findPath).toHaveBeenCalledWith('agy', '');
    await pathAgyOption.listeners.click({ stopPropagation: jest.fn() });
    expect(pathPlugin.settings.selectedProvider).toBe('agy');
    findPath.mockRestore();
  });

  it('ships four distinct community-sourced marks and compass header branding', () => {
    expect(new Set(Object.values(PROVIDER_MARKS)).size).toBe(4);
    expect(Object.values(PROVIDER_MARKS).every((mark) => mark.includes('<path'))).toBe(true);
    expect(COPILOT_ICON_SVG).toContain('#7c3aed');
  });

  it('rejects placeholder geometry and keeps provider marks theme-safe and accessible', () => {
    expect(new Set(Object.values(PROVIDER_MARKS)).size).toBe(4);
    expect(PROVIDER_MARKS.copilot).toContain('M19.245');
    expect(PROVIDER_MARKS.claude).toContain('M20.998');
    expect(PROVIDER_MARKS.codex).toContain('M9.205');
    expect(PROVIDER_MARKS.agy).toContain('M21.751');
    for (const mark of Object.values(PROVIDER_MARKS)) {
      expect(mark).toContain('fill="currentColor"');
      expect(mark).toContain('aria-hidden="true"');
      expect(mark).not.toContain('<title>');
    }
    expect(getProviderDescriptor('codex').label).toBe('OpenAI Codex');
  });

  it('never presents a Copilot model as active for native providers', () => {
    expect(getModelSelectorLabel('copilot', 'gpt-5.4')).toBe('gpt-5.4');
    expect(getModelSelectorLabel('claude', 'gpt-5.4')).toBe('CLI default');
    expect(getModelSelectorLabel('codex', 'claude-opus-4.8')).toBe('CLI default');
    expect(getModelSelectorLabel('agy', 'gpt-5.5')).toBe('CLI default');
  });

  it('hides the thinking selector and stored budget for native providers', () => {
    const parent = makeElement();
    const selector = new ThinkingBudgetSelector(parent, {
      getSettings: () => ({ selectedProvider: 'agy', model: 'gpt-5.4', thinkingBudget: 'high', permissionMode: 'agent' }),
      onModelChange: jest.fn(), onThinkingBudgetChange: jest.fn(), onPermissionModeChange: jest.fn(),
    });
    const container = parent.children[0];
    expect(container.style.display).toBe('none');
    expect(container.children[1].empty).toHaveBeenCalled();
    expect(selector).toBeTruthy();
  });
});

describe('chat toolbar layout', () => {
  it('stacks primary and secondary rows inside the toolbar', () => {
    const stylesheet = fs.readFileSync(path.resolve(__dirname, '../../../../src/style/components/input.css'), 'utf8');
    const toolbarBlock = stylesheet.match(/\.ocop-input-toolbar\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(toolbarBlock).toMatch(/display:\s*flex;/);
    expect(toolbarBlock).toMatch(/flex-direction:\s*column;/);
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

  it('keeps provider marks distinct in the shipped surface', () => {
    expect(new Set(Object.values(PROVIDER_MARKS)).size).toBe(4);
  });
});
