jest.mock('@/core/setup/AutoSetupService', () => ({
  checkProviderSetupStatus: jest.fn(),
  installProviderCLI: jest.fn(),
  markShownThisSession: jest.fn(),
}));
jest.mock('@/core/setup/nodeInstall', () => ({
  detectPackageManager: jest.fn(),
  installNode: jest.fn(),
  NODE_DOWNLOAD_URL: 'https://nodejs.org/en/download',
}));
jest.mock('@/core/setup/providerLogin', () => ({
  canDriveLogin: jest.fn(),
  startProviderLogin: jest.fn(),
  getLoginRecipe: jest.fn(),
}));
jest.mock('@/core/setup/providerReadiness', () => ({
  checkProviderReadiness: jest.fn(),
  hasLoginCheck: jest.fn(),
}));

import { App } from 'obsidian';

import { checkProviderSetupStatus, installProviderCLI } from '@/core/setup/AutoSetupService';
import { detectPackageManager, installNode } from '@/core/setup/nodeInstall';
import { canDriveLogin, getLoginRecipe, startProviderLogin } from '@/core/setup/providerLogin';
import { checkProviderReadiness } from '@/core/setup/providerReadiness';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { SetupWizardModal } from '@/ui/modals/SetupWizardModal';

/**
 * The wizard used to tell every student to open a terminal and run
 * `codex login`. codex, claude and copilot can all be driven from here; only
 * agy genuinely cannot. These tests pin that difference.
 */
describe('SetupWizardModal — install and login are actually driven', () => {
  const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
  const install = installProviderCLI as jest.MockedFunction<typeof installProviderCLI>;
  const detectPm = detectPackageManager as jest.MockedFunction<typeof detectPackageManager>;
  const nodeInstall = installNode as jest.MockedFunction<typeof installNode>;
  const canDrive = canDriveLogin as jest.MockedFunction<typeof canDriveLogin>;
  const startLogin = startProviderLogin as jest.MockedFunction<typeof startProviderLogin>;
  const recipe = getLoginRecipe as jest.MockedFunction<typeof getLoginRecipe>;
  const readiness = checkProviderReadiness as jest.MockedFunction<typeof checkProviderReadiness>;

  beforeEach(() => {
    jest.clearAllMocks();
    setupStatus.mockReturnValue({ cliFound: false, npmFound: true, status: 'ready' });
    install.mockResolvedValue({ success: true, cliPath: '/usr/local/bin/codex' });
    detectPm.mockReturnValue(null);
    nodeInstall.mockResolvedValue({ success: true });
    canDrive.mockReturnValue(true);
    recipe.mockReturnValue({ args: ['login', '--device-auth'], expectsPastedCode: false });
    readiness.mockResolvedValue({ state: 'logged-in' });
    startLogin.mockReturnValue({
      submitCode: jest.fn(),
      cancel: jest.fn(),
      done: Promise.resolve({ success: true, exitCode: 0, output: '' }),
    });
  });

  function makeWizard(): any {
    const plugin = {
      settings: { ...DEFAULT_SETTINGS, providerCliPaths: {} },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      agentService: { invalidatePathCache: jest.fn(), prewarmCapabilities: jest.fn() },
    } as any;
    const wizard: any = new SetupWizardModal(new App(), plugin);
    return wizard;
  }

  it('offers to install Node.js itself when npm is missing but brew is present', async () => {
    setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'ready' });
    detectPm.mockReturnValue({
      id: 'brew', binPath: '/opt/homebrew/bin/brew',
      installArgs: ['install', 'node'], displayCommand: 'brew install node',
    });
    const wizard = makeWizard();

    await wizard.chooseProvider('codex');

    expect(wizard.phase).toBe('node');
    expect(install).not.toHaveBeenCalled();
  });

  it('falls back to the download page only when no package manager exists', async () => {
    setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'ready' });
    detectPm.mockReturnValue(null);
    const wizard = makeWizard();

    await wizard.chooseProvider('codex');

    expect(wizard.phase).toBe('manual');
  });

  it('drives the login itself instead of sending the student to a terminal', async () => {
    const wizard = makeWizard();

    await wizard.chooseProvider('codex');
    await wizard.runInstall();

    expect(wizard.phase).toBe('login');
    await wizard.beginLogin();

    expect(startLogin).toHaveBeenCalledWith('codex', expect.any(Function), expect.any(Object));
  });

  it('confirms with a real login check before declaring success', async () => {
    const wizard = makeWizard();
    await wizard.chooseProvider('codex');
    await wizard.runInstall();
    await wizard.beginLogin();

    expect(readiness).toHaveBeenCalledWith('codex', expect.any(Object));
    expect(wizard.phase).toBe('done');
  });

  it('does not declare success when the CLI still reports logged out', async () => {
    readiness.mockResolvedValue({ state: 'logged-out' });
    const wizard = makeWizard();
    await wizard.chooseProvider('codex');
    await wizard.runInstall();
    await wizard.beginLogin();

    expect(wizard.phase).not.toBe('done');
  });

  it('still tells the student to use a terminal for agy, which has no login command', async () => {
    canDrive.mockReturnValue(false);
    const wizard = makeWizard();
    await wizard.chooseProvider('codex');
    await wizard.runInstall();

    expect(wizard.phase).toBe('login');
    await wizard.beginLogin();

    expect(startLogin).not.toHaveBeenCalled();
    expect(wizard.manualLoginRequired).toBe(true);
  });
});
