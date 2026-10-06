/**
 * agy is installed by its own official script, never by npm, so a student
 * without Node.js must not be routed through a Node.js install to reach it, and
 * the manual screen must show the official command rather than the bare name.
 */
jest.mock('@/core/setup/AutoSetupService', () => ({
  checkProviderSetupStatus: jest.fn(),
  installProviderCLI: jest.fn(),
  startProviderInstall: jest.fn(),
  markShownThisSession: jest.fn(),
}));

jest.mock('@/core/setup/nodeInstall', () => ({
  ...jest.requireActual('@/core/setup/nodeInstall'),
  detectPackageManager: jest.fn(),
  startNodeInstall: jest.fn(),
}));

import { App } from 'obsidian';

import { getManualInstallCommand, getProviderDescriptor } from '@/core/providers/providerRegistry';
import { checkProviderSetupStatus } from '@/core/setup/AutoSetupService';
import { detectPackageManager } from '@/core/setup/nodeInstall';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { SetupWizardModal } from '@/ui/modals/SetupWizardModal';

const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
const packageManager = detectPackageManager as jest.MockedFunction<typeof detectPackageManager>;

function makeWizard() {
  const adapter = { exists: async () => false, read: async () => '', write: async () => undefined };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, providerCliPaths: {} },
    manifest: { version: '0.1.34' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    storage: { getAdapter: () => adapter },
    agentService: { invalidatePathCache: jest.fn(), prewarmCapabilities: jest.fn(), redactForLog: (t: string) => t },
    isBashExpansionInFlight: jest.fn(() => false),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return new SetupWizardModal(new App(), plugin);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'manual-setup' });
  packageManager.mockReturnValue({ id: 'winget', displayCommand: 'winget install OpenJS.NodeJS', binPath: 'winget', installArgs: ['install', 'OpenJS.NodeJS'] });
});

describe('the setup wizard for agy on a machine without Node.js', () => {
  it('goes straight to the agy install screen instead of installing Node.js', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wizard = makeWizard() as any;
    await wizard.chooseProvider('agy');
    expect(wizard.phase).toBe('manual');
    expect(packageManager).not.toHaveBeenCalled();
  });

  it('shows the official install command for the platform', () => {
    const agy = getProviderDescriptor('agy');
    expect(getManualInstallCommand(agy, 'win32')).toBe('irm https://antigravity.google/cli/install.ps1 | iex');
    expect(getManualInstallCommand(agy, 'darwin')).toBe('curl -fsSL https://antigravity.google/cli/install.sh | bash');
    expect(getManualInstallCommand(getProviderDescriptor('claude'), 'win32')).toBeUndefined();
  });
});
