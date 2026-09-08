/**
 * Setup used to leave no trace at all.
 *
 * Every failure in the install path — no package manager, a winget install that
 * never verified on any Windows machine here, npm exiting non-zero, a login that
 * timed out — resolved into a result object, was painted on the wizard as one
 * Korean sentence, and vanished when the modal closed. That is precisely the
 * machine we cannot reach, so the wizard now writes what it shows.
 *
 * The line is "was the student shown this". A cancel is not a failure: logging
 * 중지 would make an empty log stop meaning anything.
 */
jest.mock('@/core/setup/AutoSetupService', () => ({
  checkProviderSetupStatus: jest.fn(),
  installProviderCLI: jest.fn(),
  startProviderInstall: jest.fn(),
  markShownThisSession: jest.fn(),
}));

jest.mock('@/core/setup/nodeInstall', () => ({
  NODE_DOWNLOAD_URL: 'https://nodejs.org',
  detectPackageManager: jest.fn(() => 'brew'),
  startNodeInstall: jest.fn(),
}));

jest.mock('@/core/setup/providerLogin', () => ({
  canDriveLogin: jest.fn(() => true),
  getLoginRecipe: jest.fn(() => ({ args: ['login'], expectsPastedCode: false })),
  startProviderLogin: jest.fn(),
}));

jest.mock('@/core/setup/providerConnection', () => ({
  checkProviderConnection: jest.fn(async () => 'not-connected'),
}));

jest.mock('@/core/setup/providerReadiness', () => ({ hasLoginCheck: jest.fn(() => true) }));

jest.mock('@/core/providers/providerRegistry', () => ({
  ...jest.requireActual('@/core/providers/providerRegistry'),
  // A machine that happens to have the CLI installed would take the other branch.
  findProviderCliPath: jest.fn(() => null),
}));

import { App } from 'obsidian';
import * as os from 'os';

import { checkProviderSetupStatus, startProviderInstall } from '@/core/setup/AutoSetupService';
import { startNodeInstall } from '@/core/setup/nodeInstall';
import { startProviderLogin } from '@/core/setup/providerLogin';
import { ERROR_LOG_PATH, type ErrorLogEntry } from '@/core/storage/ErrorLog';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { SetupWizardModal } from '@/ui/modals/SetupWizardModal';

const install = startProviderInstall as jest.MockedFunction<typeof startProviderInstall>;
const nodeInstall = startNodeInstall as jest.MockedFunction<typeof startNodeInstall>;
const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
const login = startProviderLogin as jest.MockedFunction<typeof startProviderLogin>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeWizard() {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, selectedProvider: 'claude', providerCliPaths: {} },
    manifest: { version: '0.1.15' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    storage: { getAdapter: () => adapter },
    agentService: {
      invalidatePathCache: jest.fn(),
      prewarmCapabilities: jest.fn(),
      redactForLog: (text: string) => text.replace(/github_pat_\w+/g, '[redacted]'),
    },
    isBashExpansionInFlight: jest.fn(() => false),
  } as any;
  const wizard = new SetupWizardModal(new App(), plugin);
  return { wizard, files };
}

async function entries(files: Map<string, string>): Promise<ErrorLogEntry[]> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return (files.get(ERROR_LOG_PATH) ?? '')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ErrorLogEntry);
}

describe('the setup wizard records the failures it shows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupStatus.mockReturnValue({ cliFound: false, npmFound: true, status: 'ready' });
  });

  it('writes one entry when the Node.js install fails', async () => {
    // The Windows winget path has never run on a Windows machine here. Its only
    // record of failing was a string on screen.
    const { wizard, files } = makeWizard();
    nodeInstall.mockReturnValue({
      cancel: jest.fn(),
      done: Promise.resolve({ success: false, error: 'winget: 패키지를 찾을 수 없습니다' }),
    } as any);
    (wizard as any).nodeLog = ['winget install OpenJS.NodeJS', 'error 0x8a15000f'];

    await (wizard as any).runNodeInstall();

    const logged = await entries(files);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ provider: 'node', stage: 'install' });
    expect(logged[0].message).toContain('winget');
    // The tail of the install log is the only place the real cause appears.
    expect(logged[0].message).toContain('0x8a15000f');
  });

  it('writes one entry when the CLI install fails', async () => {
    const { wizard, files } = makeWizard();
    install.mockReturnValue({
      cancel: jest.fn(),
      done: Promise.resolve({ success: false, error: 'npm ERR! code EACCES' }),
    } as any);

    await (wizard as any).runInstall();

    const logged = await entries(files);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ provider: 'claude', stage: 'install' });
    expect(logged[0].message).toContain('EACCES');
  });

  it('writes nothing when the student cancels the install', async () => {
    // 중지 is a choice, not a breakage. A log that counts it lies about what broke.
    const { wizard, files } = makeWizard();
    const done = deferred<{ success: boolean; error?: string }>();
    install.mockReturnValue({ cancel: jest.fn(), done: done.promise } as any);

    const running = (wizard as any).runInstall();
    // What the 중지 button does: release ownership, then cancel.
    (wizard as any).cliInstallSession = null;
    done.resolve({ success: false, error: 'cancelled' });
    await running;

    expect(await entries(files)).toHaveLength(0);
  });

  it('writes one entry when the CLI still cannot be found on re-check', async () => {
    const { wizard, files } = makeWizard();

    await (wizard as any).recheck();

    const logged = await entries(files);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ provider: 'claude', stage: 'resolve' });
  });

  it('redacts what it logs', async () => {
    const { wizard, files } = makeWizard();
    install.mockReturnValue({
      cancel: jest.fn(),
      done: Promise.resolve({ success: false, error: 'npm ERR! auth github_pat_11ABCsecret failed' }),
    } as any);

    await (wizard as any).runInstall();

    const logged = await entries(files);
    expect(logged[0].message).not.toContain('github_pat_11ABCsecret');
  });

  it('masks the home directory out of the install output it keeps', async () => {
    // npm prints absolute paths on failure, and on Windows those start
    // `C:\Users\<real name>\`. The log is handed to a third party.
    const { wizard, files } = makeWizard();
    install.mockReturnValue({
      cancel: jest.fn(),
      done: Promise.resolve({ success: false, error: `npm ERR! path ${os.homedir()}/.npm/_logs` }),
    } as any);

    await (wizard as any).runInstall();

    const logged = await entries(files);
    expect(logged[0].message).not.toContain(os.homedir());
    expect(logged[0].message).toContain('~');
  });

  it('does not break the wizard when the vault refuses an adapter', async () => {
    const { wizard } = makeWizard();
    (wizard as any).plugin.storage = { getAdapter: () => { throw new Error('vault not ready'); } };
    install.mockReturnValue({
      cancel: jest.fn(),
      done: Promise.resolve({ success: false, error: 'npm ERR! code EACCES' }),
    } as any);

    await expect((wizard as any).runInstall()).resolves.toBeUndefined();
    expect((wizard as any).phase).toBe('error');
  });

  it('never persists the raw output of a login attempt', async () => {
    // A device-auth login prints a verification code and a URL that carries a
    // session. Those are short-lived credentials, and the log is a file the
    // student hands to someone else — so the login summary is kept and the CLI's
    // own output is not. Redaction cannot help here: it removes configured
    // values, and a device code was never configured anywhere.
    const { wizard, files } = makeWizard();
    login.mockImplementation(((_provider: unknown, onEvent: (e: { type: string; text: string }) => void) => {
      onEvent({ type: 'output', text: 'Verification code: ABCD-1234' });
      onEvent({ type: 'output', text: 'Open https://github.com/login/device?session=xyzsecret' });
      return { submitCode: jest.fn(), cancel: jest.fn(), done: Promise.resolve({ success: false, exitCode: 1, output: '' }) };
    }) as any);

    await (wizard as any).beginLogin();

    const logged = await entries(files);
    expect(logged).toHaveLength(1);
    expect(logged[0].stage).toBe('login');
    expect(logged[0].message).not.toContain('ABCD-1234');
    expect(logged[0].message).not.toContain('xyzsecret');
  });
});

