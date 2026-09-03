jest.mock('@/core/setup/AutoSetupService', () => ({
  checkProviderSetupStatus: jest.fn(),
  installProviderCLI: jest.fn(),
  markShownThisSession: jest.fn(),
}));

import { App } from 'obsidian';

import { checkProviderSetupStatus, installProviderCLI } from '@/core/setup/AutoSetupService';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { SetupWizardModal } from '@/ui/modals/SetupWizardModal';

describe('SetupWizardModal provider choice', () => {
  const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
  const install = installProviderCLI as jest.MockedFunction<typeof installProviderCLI>;

  beforeEach(() => {
    jest.clearAllMocks();
    setupStatus.mockReturnValue({ cliFound: false, npmFound: true, status: 'ready' });
    install.mockReturnValue(new Promise(() => undefined));
  });

  function makeWizard(): SetupWizardModal {
    const plugin = {
      settings: { ...DEFAULT_SETTINGS, providerCliPaths: {} },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      agentService: { invalidatePathCache: jest.fn(), prewarmCapabilities: jest.fn() },
    } as any;
    return new SetupWizardModal(new App(), plugin);
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
});
