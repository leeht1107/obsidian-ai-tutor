/**
 * The only route back to the multi-select installer.
 *
 * The first-run chooser appears once, on startup, and only when the selected
 * provider has no CLI — so a student who later wants a second AI has nowhere to
 * go but the per-provider 연결 button, which installs one CLI and makes it the
 * default in the same click. This settings button opens the chooser instead,
 * and it must open it WITHOUT a target: passing one would silently drop back to
 * the single-provider path and take "the default is chosen last" with it.
 */
const constructed: unknown[][] = [];
jest.mock('@/ui/modals/SetupWizardModal', () => ({
  SetupWizardModal: class {
    constructor(...args: unknown[]) { constructed.push(args); }
    onClose = jest.fn();
    open = jest.fn();
  },
}));

// The rows spawn a real CLI probe each; this test is about the button, not them.
jest.mock('@/core/setup/providerConnection', () => ({
  ...jest.requireActual('@/core/setup/providerConnection'),
  checkProviderConnection: jest.fn().mockResolvedValue('unknown'),
}));

type Row = { name: string; click?: () => unknown };
const rows: Row[] = [];

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  class RecordingSetting {
    private row: Row = { name: '' };
    constructor() { rows.push(this.row); }
    setName(name: string) { this.row.name = name; return this; }
    setDesc() { return this; }
    setHeading() { return this; }
    addText() { return this; }
    addTextArea() { return this; }
    addToggle() { return this; }
    addDropdown() { return this; }
    addSlider() { return this; }
    addExtraButton() { return this; }
    addButton(cb: (b: unknown) => void) {
      const button = {
        setButtonText: () => button,
        setTooltip: () => button,
        setCta: () => button,
        setWarning: () => button,
        setDisabled: () => button,
        onClick: (fn: () => unknown) => { this.row.click = fn; return button; },
      };
      cb(button);
      return this;
    }
  }
  return { ...actual, Setting: RecordingSetting };
});

import { App } from 'obsidian';

import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { ObsidianCopilotSettingTab } from '@/features/settings/ObsidianCopilotSettings';

function makeEl(): Record<string, unknown> {
  const el: Record<string, unknown> = {};
  Object.assign(el, {
    createEl: () => makeEl(),
    createDiv: () => makeEl(),
    createSpan: () => makeEl(),
    addEventListener: () => undefined,
    appendChild: () => undefined,
    setText: () => undefined,
    addClass: () => undefined,
    removeClass: () => undefined,
    toggleClass: () => undefined,
    empty: () => undefined,
    setAttribute: () => undefined,
    style: {},
    classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined },
  });
  return el;
}

describe('the settings tab can reopen the installer', () => {
  it('opens the chooser with no target provider', async () => {
    const plugin = {
      settings: { ...DEFAULT_SETTINGS, providerCliPaths: {} },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      providerConnections: {},
      agentService: { redactForLog: (t: string) => t },
      isBashExpansionInFlight: () => false,
      setProviderConnection: jest.fn(),
      installBundledSkillsOnce: jest.fn().mockResolvedValue(undefined),
      storage: { getAdapter: () => undefined },
      manifest: { version: '0.1.16' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const tab = new ObsidianCopilotSettingTab(new App(), plugin);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tab as any).containerEl = makeEl();

    tab.display();

    const wizardRow = rows.find((row) => row.name === '설치 마법사');
    expect(wizardRow?.click).toBeDefined();
    await wizardRow?.click?.();

    expect(constructed).toHaveLength(1);
    // app and plugin only. A third argument is the single-provider path.
    expect(constructed[0]).toHaveLength(2);
  });
});
