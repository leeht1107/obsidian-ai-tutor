jest.mock('@/core/setup/AutoSetupService', () => ({
  checkProviderSetupStatus: jest.fn(),
  installProviderCLI: jest.fn(),
  markShownThisSession: jest.fn(),
}));
jest.mock('@/core/setup/nodeInstall', () => ({
  detectPackageManager: jest.fn(),
  installNode: jest.fn(),
  startNodeInstall: jest.fn(),
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
import { detectPackageManager, installNode, startNodeInstall } from '@/core/setup/nodeInstall';
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

/**
 * Regressions for the independent review of the install/login flow.
 * Each test fails against the pre-review code.
 */
describe('SetupWizardModal — review regressions', () => {
  const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
  const install = installProviderCLI as jest.MockedFunction<typeof installProviderCLI>;
  const canDrive = canDriveLogin as jest.MockedFunction<typeof canDriveLogin>;
  const startLogin = startProviderLogin as jest.MockedFunction<typeof startProviderLogin>;
  const recipe = getLoginRecipe as jest.MockedFunction<typeof getLoginRecipe>;
  const readiness = checkProviderReadiness as jest.MockedFunction<typeof checkProviderReadiness>;
  const startNode = startNodeInstall as jest.MockedFunction<typeof startNodeInstall>;
  const detectPm = detectPackageManager as jest.MockedFunction<typeof detectPackageManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    setupStatus.mockReturnValue({ cliFound: false, npmFound: true, status: 'ready' });
    install.mockResolvedValue({ success: true, cliPath: '/usr/local/bin/codex' });
    canDrive.mockReturnValue(true);
    recipe.mockReturnValue({ args: ['login', '--device-auth'], expectsPastedCode: false });
    readiness.mockResolvedValue({ state: 'logged-in' });
    detectPm.mockReturnValue(null);
    startNode.mockReturnValue({ cancel: jest.fn(), done: Promise.resolve({ success: true }) });
    startLogin.mockReturnValue({
      submitCode: jest.fn(), cancel: jest.fn(),
      done: Promise.resolve({ success: true, exitCode: 0, output: '' }),
    });
  });

  function makeWizard(): any {
    const plugin = {
      settings: { ...DEFAULT_SETTINGS, providerCliPaths: {} },
      saveSettings: jest.fn().mockResolvedValue(undefined),
      agentService: { invalidatePathCache: jest.fn(), prewarmCapabilities: jest.fn() },
    } as any;
    return new SetupWizardModal(new App(), plugin);
  }

  /**
   * The obsidian mock declares `onClose = jest.fn()` as a class field, which
   * shadows the subclass method on every instance. Reach past it to run the
   * real teardown.
   */
  function closeForReal(wizard: any): void {
    (SetupWizardModal.prototype as any).onClose.call(wizard);
  }

  it('does not claim setup is done when the CLI cannot confirm a login', async () => {
    // copilot and agy expose no status command. Exiting 0 is not proof.
    readiness.mockResolvedValue({ state: 'unknown' });
    const wizard = makeWizard();
    await wizard.chooseProvider('codex');
    await wizard.runInstall();
    await wizard.beginLogin();

    expect(wizard.phase).toBe('unverified');
    expect(wizard.phase).not.toBe('done');
  });

  it('does not claim setup is done when 다시 확인 cannot confirm a login', async () => {
    readiness.mockResolvedValue({ state: 'unknown' });
    const wizard = makeWizard();
    wizard.plugin.settings.selectedProvider = 'copilot';
    jest.spyOn(wizard, 'hasSelectedProviderCli').mockReturnValue(true);

    await wizard.recheck();

    expect(wizard.phase).toBe('unverified');
  });

  it('stops a running Node.js install when the student closes the wizard', async () => {
    const cancel = jest.fn();
    let resolveInstall: (r: any) => void = () => undefined;
    startNode.mockReturnValue({ cancel, done: new Promise((r) => { resolveInstall = r; }) });
    setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'ready' });
    detectPm.mockReturnValue({
      id: 'brew', binPath: '/opt/homebrew/bin/brew',
      installArgs: ['install', 'node'], displayCommand: 'brew install node',
    });

    const wizard = makeWizard();
    await wizard.chooseProvider('codex');
    expect(wizard.phase).toBe('node');
    void wizard.runNodeInstall();
    await Promise.resolve();

    closeForReal(wizard);

    expect(cancel).toHaveBeenCalledTimes(1);
    resolveInstall({ success: true });
  });

  it('does not write into the modal after it has been closed', async () => {
    let finishLogin: (r: any) => void = () => undefined;
    startLogin.mockReturnValue({
      submitCode: jest.fn(), cancel: jest.fn(),
      done: new Promise((r) => { finishLogin = r; }),
    });
    const wizard = makeWizard();
    await wizard.chooseProvider('codex');
    await wizard.runInstall();
    const loginDone = wizard.beginLogin();

    closeForReal(wizard);
    // Only what happens *after* the close matters.
    wizard.contentEl.createDiv.mockClear();

    finishLogin({ success: true, exitCode: 0, output: '' });
    await loginDone;

    // render may be entered, but it must not build UI in the emptied modal.
    expect(wizard.contentEl.createDiv).not.toHaveBeenCalled();
  });
});
