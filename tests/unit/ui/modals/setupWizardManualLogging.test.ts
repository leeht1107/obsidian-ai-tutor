/**
 * The screen this whole feature was built for, and the one it never recorded.
 *
 * A Windows machine with no Node.js and no package manager reaches the setup
 * wizard's "install it yourself" screen. Release 0.1.15 wired four failures in
 * this modal and not this one, so the student most likely to be stranded handed
 * over an empty file.
 *
 * The other half of the contract is tested here too, because it is the half
 * that gives an empty file its meaning: a student who presses 중지, or who
 * chooses 직접 설치할게요, reaches the same screen and must leave no entry.
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

import { checkProviderSetupStatus, startProviderInstall } from '@/core/setup/AutoSetupService';
import { detectPackageManager, startNodeInstall } from '@/core/setup/nodeInstall';
import { ERROR_LOG_PATH, type ErrorLogEntry } from '@/core/storage/ErrorLog';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { SetupWizardModal } from '@/ui/modals/SetupWizardModal';

const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
const nodeInstall = startNodeInstall as jest.MockedFunction<typeof startNodeInstall>;
const packageManager = detectPackageManager as jest.MockedFunction<typeof detectPackageManager>;
const install = startProviderInstall as jest.MockedFunction<typeof startProviderInstall>;

function makeWizard() {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, providerCliPaths: {} },
    manifest: { version: '0.1.16' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    storage: { getAdapter: () => adapter },
    agentService: {
      invalidatePathCache: jest.fn(),
      prewarmCapabilities: jest.fn(),
      redactForLog: (text: string) => text,
    },
    isBashExpansionInFlight: jest.fn(() => false),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { wizard: new SetupWizardModal(new App(), plugin), files };
}

async function entries(files: Map<string, string>): Promise<ErrorLogEntry[]> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return (files.get(ERROR_LOG_PATH) ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ErrorLogEntry);
}

beforeEach(() => {
  jest.clearAllMocks();
  install.mockReturnValue({ cancel: jest.fn(), done: new Promise(() => undefined) });
});

describe('the setup wizard records the dead ends it shows a student', () => {
  it('records the machine with neither Node.js nor a package manager', async () => {
    setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'needs-node' });
    packageManager.mockReturnValue(null);
    const { wizard, files } = makeWizard();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (wizard as any).chooseProvider('claude');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((wizard as any).phase).toBe('manual');
    const logged = await entries(files);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ provider: 'claude', stage: 'install' });
    expect(logged[0].message).toContain('패키지 관리자');
  });

  it('records npm still being missing after Node.js reported a successful install', async () => {
    // The hardest failure to describe afterwards: the student did everything the
    // wizard asked and landed on the manual screen anyway.
    setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'needs-node' });
    packageManager.mockReturnValue({ id: 'winget', displayCommand: 'winget install OpenJS.NodeJS', binPath: 'winget', installArgs: ['install', 'OpenJS.NodeJS'] });
    nodeInstall.mockReturnValue({ cancel: jest.fn(), done: Promise.resolve({ success: true }) });
    const { wizard, files } = makeWizard();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (wizard as any).runNodeInstall();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((wizard as any).phase).toBe('manual');
    const logged = await entries(files);
    expect(logged).toHaveLength(1);
    expect(logged[0].message).toContain('npm');
  });

  it('writes nothing when the student chooses to install Node.js themselves', async () => {
    // Not a failure. An entry here would mean an empty log no longer proves
    // anything, which is the only thing this file is for.
    setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'needs-node' });
    packageManager.mockReturnValue({ id: 'winget', displayCommand: 'winget install OpenJS.NodeJS', binPath: 'winget', installArgs: ['install', 'OpenJS.NodeJS'] });
    const { wizard, files } = makeWizard();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = wizard as any;
    await w.chooseProvider('claude');
    expect(w.phase).toBe('node');
    // What the 직접 설치할게요 button does.
    w.nodeSession = null;
    w.phase = 'manual';

    expect(await entries(files)).toEqual([]);
  });

  it('writes nothing when the student stops a running CLI install', async () => {
    setupStatus.mockReturnValue({ cliFound: false, npmFound: true, status: 'needs-cli' });
    const { wizard, files } = makeWizard();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = wizard as any;
    await w.chooseProvider('claude');
    expect(w.phase).toBe('installing');
    // What the 중지 button does.
    const session = w.cliInstallSession;
    w.cliInstallSession = null;
    session?.cancel();
    w.phase = 'manual';

    expect(await entries(files)).toEqual([]);
  });

  it('does not take the wizard down when the vault refuses an adapter', async () => {
    // The arguments are evaluated before the logger's own guard is entered, so a
    // throwing `getAdapter()` would escape into the student's setup.
    setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'needs-node' });
    packageManager.mockReturnValue(null);
    const { wizard } = makeWizard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wizard as any).plugin.storage = { getAdapter: () => { throw new Error('vault not ready'); } };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((wizard as any).chooseProvider('claude')).resolves.toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((wizard as any).phase).toBe('manual');
  });
});
