/**
 * The provider menu in the chat toolbar.
 *
 * Two things it must not go back to being. It used to answer an unusable
 * provider with a line of text and no way to act on it, so a student with
 * copilot installed but not logged in could not reach the login flow at all.
 * And it used to spawn every installed CLI on each open to ask who was logged
 * in — slow, and unanswerable for copilot, which has no status command.
 */
import * as providerRegistry from '@/core/providers/providerRegistry';
import * as readiness from '@/core/setup/providerReadiness';
import { createProviderSelector } from '@/features/chat/ObsidianCopilotView';
import { PermissionToggle } from '@/ui/components/InputToolbar';

const openSetupWizard = jest.fn();
const wizardTarget = jest.fn();
jest.mock('@/ui/modals/SetupWizardModal', () => ({
  SetupWizardModal: class {
    constructor(_app: unknown, _plugin: unknown, target?: string) { wizardTarget(target); }
    open = openSetupWizard;
  },
}));

describe('provider popover click on an unusable provider', () => {
  it('opens the setup wizard instead of only printing a hint', async () => {
    openSetupWizard.mockClear();
    wizardTarget.mockClear();
    const findPath = jest.spyOn(providerRegistry, 'findProviderCliPath').mockReturnValue(null);
    const toolbar = makeToolbarElement();
    const plugin = { app: {}, settings: { selectedProvider: 'copilot' }, saveSettings: jest.fn() };
    createProviderSelector(toolbar, plugin as never);
    const popover = toolbar.children[0].children[1];
    const option = popover.children.filter((c: any) => c.elementOptions?.cls === 'ocop-provider-option').at(-1);
    await option.listeners.click({ stopPropagation: jest.fn() });
    await Promise.resolve();
    expect(openSetupWizard).toHaveBeenCalledTimes(1);
    // The student clicked a specific provider; making them choose again in the
    // wizard loses what they just told us.
    expect(wizardTarget).toHaveBeenCalledWith('agy');
    findPath.mockRestore();
  });
});

/**
 * The write-authority counter in main.ts captures the permission mode on its 0 -> 1
 * edge and holds it until every overlapping write-capable region settles back to 0.
 * Provider switching used to stay enabled through that whole window: a second region
 * starting mid-stream would resolve against whichever provider was selected BY THEN,
 * not the one the capture was taken against. Locked here the same way
 * PermissionToggle already locks itself while busy.
 */
describe('provider selector — locked while a write-capable region is in flight', () => {
  it('refuses a switch to a ready, different provider while busy; selectedProvider is unchanged', async () => {
    const findPath = jest.spyOn(providerRegistry, 'findProviderCliPath').mockReturnValue('/bin/cli');
    const toolbar = makeToolbarElement();
    const plugin = {
      app: {},
      settings: { selectedProvider: 'claude' as const },
      saveSettings: jest.fn(),
      isBashExpansionInFlight: () => true,
    };
    createProviderSelector(toolbar, plugin as never);
    const popover = toolbar.children[0].children[1];
    const codexOption = popover.children.filter((c: any) => c.elementOptions?.cls === 'ocop-provider-option')[2];
    await codexOption.listeners.click({ stopPropagation: jest.fn() });

    expect(plugin.settings.selectedProvider).toBe('claude');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    findPath.mockRestore();
  });

  it('switches normally once nothing is in flight', async () => {
    const findPath = jest.spyOn(providerRegistry, 'findProviderCliPath').mockReturnValue('/bin/cli');
    const toolbar = makeToolbarElement();
    const plugin = {
      app: {},
      settings: { selectedProvider: 'claude' as const },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      isBashExpansionInFlight: () => false,
    };
    createProviderSelector(toolbar, plugin as never);
    const popover = toolbar.children[0].children[1];
    const codexOption = popover.children.filter((c: any) => c.elementOptions?.cls === 'ocop-provider-option')[2];
    await codexOption.listeners.click({ stopPropagation: jest.fn() });

    expect(plugin.settings.selectedProvider).toBe('codex');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    findPath.mockRestore();
  });

  it("reproduces the reviewer's mixed-authority sequence: a captured Ask cannot be undercut by switching to a provider that would resolve to Agent", async () => {
    const findPath = jest.spyOn(providerRegistry, 'findProviderCliPath').mockReturnValue('/bin/cli');

    // Shared state: one counter, one settings object, read by both controls exactly as
    // main.ts and the toolbar wire them in the real view.
    let inFlight = false;
    const settings: any = { selectedProvider: 'claude', permissionMode: 'ask' };
    const plugin = {
      app: {},
      settings,
      saveSettings: jest.fn().mockResolvedValue(undefined),
      isBashExpansionInFlight: () => inFlight,
    };

    // Step 1: a Claude request starts. writeAuthorityCount goes 0 -> 1 and main.ts
    // captures 'ask' (Claude, not blanket-write-acknowledged, resolves to ask).
    inFlight = true;
    const capturedPermissionMode: 'ask' | 'agent' = 'ask';

    const toolbarParent = makeToolbarElement();
    const toggle = new PermissionToggle(toolbarParent, {
      getSettings: () => settings,
      onPermissionModeChange: jest.fn(),
      isBashExpansionInFlight: () => inFlight,
      getCapturedPermissionMode: () => capturedPermissionMode,
    } as never);
    const toggleLabelEl = toolbarParent.children[0].children[0];
    expect(toggleLabelEl.setText).toHaveBeenCalledWith('Ask');

    // Step 2: while it streams, attempt to switch the provider to Codex, which needs
    // no consent and would resolve to 'agent' if the switch were allowed through.
    const providerToolbar = makeToolbarElement();
    createProviderSelector(providerToolbar, plugin as never);
    const popover = providerToolbar.children[0].children[1];
    const codexOption = popover.children.filter((c: any) => c.elementOptions?.cls === 'ocop-provider-option')[2];
    await codexOption.listeners.click({ stopPropagation: jest.fn() });

    // The switch never happened, so a second region cannot resolve against Codex.
    expect(settings.selectedProvider).toBe('claude');
    expect(plugin.saveSettings).not.toHaveBeenCalled();

    // And the toggle, repainted, still reads the mode captured at step 1.
    toggle.updateDisplay();
    expect(toggleLabelEl.setText).toHaveBeenLastCalledWith('Ask');

    findPath.mockRestore();
  });
});

function makeToolbarElement(): any {
  const attributes: Record<string, string> = {};
  const element: any = { children: [], listeners: {} };
  const child = (options: any) => { const c = makeToolbarElement(); c.elementOptions = options; element.children.push(c); return c; };
  element.createDiv = jest.fn(child);
  element.createSpan = jest.fn(child);
  element.createEl = jest.fn((_tag: string, options: any) => child(options));
  Object.defineProperty(element, 'firstElementChild', { get: () => element.children[0] ?? null });
  element.insertBefore = jest.fn((c: any) => c);
  element.addEventListener = jest.fn((event: string, handler: () => void) => { element.listeners[event] = handler; });
  element.emit = (event: string) => element.listeners[event]?.({ stopPropagation: jest.fn() });
  Object.assign(element, {
    setAttribute: jest.fn((n: string, v: string) => { attributes[n] = v; }),
    getAttribute: jest.fn((n: string) => attributes[n] ?? null),
    removeAttribute: jest.fn((n: string) => { delete attributes[n]; }),
    empty: jest.fn(), hasClass: jest.fn().mockReturnValue(false), addClass: jest.fn(),
    removeClass: jest.fn(), setText: jest.fn(), contains: jest.fn().mockReturnValue(false),
    toggleClass: jest.fn(), innerHTML: '',
  });
  return element;
}

/**
 * The menu shows what the settings tab decided, and only when it is actionable.
 */
describe('provider badge', () => {
  it('names only the providers that need the student to do something', () => {
    const findPath = jest.spyOn(providerRegistry, 'findProviderCliPath')
      .mockImplementation((id) => (id === 'agy' ? null : '/bin/cli'));
    const probe = jest.spyOn(readiness, 'checkProviderReadiness');
    const toolbar = makeToolbarElement();
    const plugin = {
      app: {},
      settings: { selectedProvider: 'copilot' },
      saveSettings: jest.fn(),
      providerConnections: {
        copilot: { state: 'connected' as const, at: 1 },
        claude: { state: 'not-connected' as const, at: 1 },
        // codex: never checked. Saying so in the menu is noise the student
        // cannot act on, so the row carries the name and nothing else.
      },
    };
    createProviderSelector(toolbar, plugin as never);

    const container = toolbar.children[0];
    container.children[0].emit('click');

    const popover = container.children[1];
    const statusTexts = popover.children
      .filter((c: any) => c.elementOptions?.cls === 'ocop-provider-option')
      .map((option: any) => option.children
        .find((c: any) => c.elementOptions?.cls === 'ocop-provider-option-status')
        ?.elementOptions?.text)
      .slice(-4);

    // PROVIDERS order is copilot, claude, codex, agy.
    expect(statusTexts).toEqual([undefined, '연결 필요', undefined, '설치 필요']);
    // And drawing any of it must still spawn nothing.
    expect(probe).not.toHaveBeenCalled();

    findPath.mockRestore();
    probe.mockRestore();
  });

  it('marks each provider with its own colour class', () => {
    const findPath = jest.spyOn(providerRegistry, 'findProviderCliPath').mockReturnValue('/bin/cli');
    const toolbar = makeToolbarElement();
    createProviderSelector(toolbar, {
      app: {}, settings: { selectedProvider: 'claude' }, saveSettings: jest.fn(),
    } as never);

    const popover = toolbar.children[0].children[1];
    const markClasses = popover.children
      .filter((c: any) => c.elementOptions?.cls === 'ocop-provider-option')
      .map((option: any) => option.children[0]?.elementOptions?.cls)
      .slice(-4);

    expect(markClasses).toEqual([
      'ocop-provider-mark is-copilot',
      'ocop-provider-mark is-claude',
      'ocop-provider-mark is-codex',
      'ocop-provider-mark is-agy',
    ]);
    findPath.mockRestore();
  });
});
