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

import * as providerRegistry from '@/core/providers/providerRegistry';
import { formatManualCliCommand, getManualInstallCommand, getProviderDescriptor } from '@/core/providers/providerRegistry';
import { checkProviderSetupStatus, startProviderInstall } from '@/core/setup/AutoSetupService';
import { detectPackageManager } from '@/core/setup/nodeInstall';
import * as providerLogin from '@/core/setup/providerLogin';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { SetupWizardModal } from '@/ui/modals/SetupWizardModal';

const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
const packageManager = detectPackageManager as jest.MockedFunction<typeof detectPackageManager>;
const install = startProviderInstall as jest.MockedFunction<typeof startProviderInstall>;

/** Every text the obsidian mock was handed under the first section, plus its buttons. */
function renderedButtons(wizard: any): { text: string; click: () => void }[] {
  const wrap = wizard.contentEl.createDiv.mock.results[0].value;
  return wrap.createEl.mock.calls
    .map((call: any[], i: number) => ({ call, el: wrap.createEl.mock.results[i].value }))
    .filter(({ call }: any) => call[0] === 'button')
    .map(({ call, el }: any) => ({
      text: call[1]?.text ?? '',
      click: () => el.addEventListener.mock.calls.find((c: any[]) => c[0] === 'click')?.[1](),
    }));
}

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

// The installer may fail to put agy on PATH; the plugin can still find agy.exe, so the
// login step must name that file instead of a bare `agy` the terminal cannot resolve.
describe('the agy login command', () => {
  it('invokes the discovered executable through the PowerShell call operator on Windows', () => {
    expect(formatManualCliCommand('agy', 'C:\\Users\\홍 길동\\AppData\\Local\\agy\\bin\\agy.exe', 'win32'))
      .toBe("& 'C:\\Users\\홍 길동\\AppData\\Local\\agy\\bin\\agy.exe'");
  });

  it('quotes the discovered executable elsewhere', () => {
    expect(formatManualCliCommand('agy', "/Users/o'b/.local/bin/agy", 'darwin')).toBe("'/Users/o'\\''b/.local/bin/agy'");
  });

  // PowerShell expands $ and backticks inside double quotes; a Windows profile name may
  // contain either, so only a single-quoted literal names the file exactly.
  it('keeps $, backticks and apostrophes literal in PowerShell', () => {
    expect(formatManualCliCommand('agy', "C:\\Users\\a$b`c'd\\agy.exe", 'win32'))
      .toBe("& 'C:\\Users\\a$b`c''d\\agy.exe'");
  });

  it('keeps the plain command when nothing was discovered', () => {
    expect(formatManualCliCommand('agy', null, 'win32')).toBe('agy');
  });
});

describe('the agy login screen after a recheck finds the fresh install', () => {
  it('shows the terminal login, not the in-window login agy cannot drive', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wizard = makeWizard() as any;
    wizard.current = 'agy';
    wizard.phase = 'login';
    wizard.render();
    // The obsidian mock does not track children: collect every text handed to createEl.
    const wrap = wizard.contentEl.createDiv.mock.results[0].value;
    const text = wrap.createEl.mock.calls.map((call: any[]) => call[1]?.text ?? '').join('\n');
    expect(text).not.toContain('터미널은 필요 없습니다');
    expect(text).toContain('직접 로그인');
  });
});

describe('the agy install screen runs the official installer on consent', () => {
  it('offers 설치 시작, and pressing it starts the agy install', async () => {
    // The installer recipes exist for Windows and macOS only.
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;
    install.mockReturnValue({ cancel: jest.fn(), done: new Promise(() => undefined) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wizard = makeWizard() as any;
    await wizard.chooseProvider('agy');
    expect(wizard.phase).toBe('manual');

    const start = renderedButtons(wizard).find((b) => b.text === '설치 시작');
    expect(start).toBeDefined();
    start!.click();

    expect(wizard.phase).toBe('installing');
    expect(install).toHaveBeenCalledWith('agy', expect.any(Function));
  });
});

describe('the agy install failure screen', () => {
  it('offers the official install command to run by hand, not the bare name', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wizard = makeWizard() as any;
    wizard.current = 'agy';
    wizard.phase = 'error';
    wizard.errorDetail = 'PowerShell exited with code 1';
    wizard.render();

    const wrap = wizard.contentEl.createDiv.mock.results[0].value;
    const commands = wrap.createDiv.mock.results
      .flatMap((r: any) => r.value.createEl.mock.calls)
      .filter((call: any[]) => call[0] === 'code')
      .map((call: any[]) => call[1].text);
    expect(commands).toContain(getManualInstallCommand(getProviderDescriptor('agy')));
  });
});

describe('the agy login screen opens a terminal for the sign-in', () => {
  afterEach(() => jest.restoreAllMocks());

  function loginScreen() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wizard = makeWizard() as any;
    wizard.current = 'agy';
    wizard.phase = 'login';
    wizard.render();
    return renderedButtons(wizard);
  }

  it('opens the discovered agy when the student presses 로그인 창 열기', () => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return;
    jest.spyOn(providerRegistry, 'resolveProviderCliPath').mockReturnValue('C:\\agy\\agy.exe');
    const open = jest.spyOn(providerLogin, 'openLoginTerminal').mockReturnValue(true);

    const button = loginScreen().find((b) => b.text === '로그인 창 열기');
    expect(button).toBeDefined();
    button!.click();

    expect(open).toHaveBeenCalledWith('C:\\agy\\agy.exe');
  });

  it('offers no button when agy was not found', () => {
    jest.spyOn(providerRegistry, 'resolveProviderCliPath').mockReturnValue(null);
    expect(loginScreen().some((b) => b.text === '로그인 창 열기')).toBe(false);
  });
});

describe('the agy unverified screen after a recheck that could not decide', () => {
  afterEach(() => jest.restoreAllMocks());

  it('names the discovered agy, not a bare command the terminal may not resolve', () => {
    jest.spyOn(providerRegistry, 'resolveProviderCliPath').mockReturnValue('C:\\agy\\agy.exe');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wizard = makeWizard() as any;
    wizard.current = 'agy';
    wizard.phase = 'unverified';
    wizard.render();

    const wrap = wizard.contentEl.createDiv.mock.results[0].value;
    const commands = wrap.createDiv.mock.results
      .flatMap((r: any) => r.value.createEl.mock.calls)
      .filter((call: any[]) => call[0] === 'code')
      .map((call: any[]) => call[1].text);
    expect(commands).toEqual([providerRegistry.formatManualCliCommand('agy', 'C:\\agy\\agy.exe')]);
  });
});
