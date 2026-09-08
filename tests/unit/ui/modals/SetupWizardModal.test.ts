jest.mock('@/core/setup/AutoSetupService', () => ({
  checkProviderSetupStatus: jest.fn(),
  installProviderCLI: jest.fn(),
  startProviderInstall: jest.fn(),
  markShownThisSession: jest.fn(),
}));

import { App } from 'obsidian';

import { checkProviderSetupStatus, startProviderInstall } from '@/core/setup/AutoSetupService';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { SetupWizardModal } from '@/ui/modals/SetupWizardModal';

describe('SetupWizardModal provider choice', () => {
  const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
  const install = startProviderInstall as jest.MockedFunction<typeof startProviderInstall>;

  beforeEach(() => {
    jest.clearAllMocks();
    setupStatus.mockReturnValue({ cliFound: false, npmFound: true, status: 'ready' });
    install.mockReturnValue({ cancel: jest.fn(), done: new Promise(() => undefined) });
  });

  function makePlugin(busy = false) {
    return {
      settings: { ...DEFAULT_SETTINGS, providerCliPaths: {} },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      agentService: { invalidatePathCache: jest.fn(), prewarmCapabilities: jest.fn() },
      isBashExpansionInFlight: jest.fn(() => busy),
    } as any;
  }

  function makeWizard(busy = false): SetupWizardModal {
    return new SetupWizardModal(new App(), makePlugin(busy));
  }

  it('opens at provider selection and spawns no CLI before a student chooses', () => {
    const wizard = makeWizard();

    wizard.onOpen();

    expect(install).not.toHaveBeenCalled();
  });

  it('starts setup only for the provider the student selected', async () => {
    const wizard = makeWizard();

    await (wizard as any).chooseProvider('claude');

    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith('claude', expect.any(Function));
  });

  // Switching provider while a request is running flips the effective permission mode
  // under a child process that is already spawned, so the toolbar can read Ask while an
  // Agent-flagged CLI writes. The toolbar and Settings entry points refuse it; this pins
  // the guard on the assignment itself, where a future caller cannot route around it.
  it('refuses to switch to a different provider while a request is in flight', async () => {
    const plugin = makePlugin(true);
    const wizard = new SetupWizardModal(new App(), plugin);

    await (wizard as any).chooseProvider('claude');

    expect(plugin.settings.selectedProvider).toBe(DEFAULT_SETTINGS.selectedProvider);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  // Re-selecting the provider already in use changes nothing, so the CLI-not-found
  // wizard and the first-run picker must still work mid-flight.
  it('allows re-selecting the provider already in use while a request is in flight', async () => {
    const plugin = makePlugin(true);
    const wizard = new SetupWizardModal(new App(), plugin);

    await (wizard as any).chooseProvider(DEFAULT_SETTINGS.selectedProvider);

    expect(plugin.settings.selectedProvider).toBe(DEFAULT_SETTINGS.selectedProvider);
    expect(install).toHaveBeenCalledWith(DEFAULT_SETTINGS.selectedProvider, expect.any(Function));
  });
});
