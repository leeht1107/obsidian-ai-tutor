/**
 * The first-run wizard installs every CLI the student ticked, then walks the
 * logins, then asks which one should be the default.
 *
 * Two things these tests exist to pin. Installs run one at a time, because
 * `startProviderInstall` spawns an independent `npm install -g` and nothing in
 * that module locks the global prefix — serialising is the caller's job. And
 * `selectedProvider` is written exactly once, on the last screen: writing it per
 * entry, which is what the single-provider path does, would silently make
 * whichever CLI happened to be processed last the student's default.
 */
jest.mock('@/core/setup/AutoSetupService', () => ({
  checkProviderSetupStatus: jest.fn(),
  installProviderCLI: jest.fn(),
  startProviderInstall: jest.fn(),
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
  hasLoginCheck: jest.fn(),
}));
jest.mock('@/core/setup/providerConnection', () => ({
  checkProviderConnection: jest.fn(),
}));

import { App } from 'obsidian';

import { checkProviderSetupStatus, startProviderInstall } from '@/core/setup/AutoSetupService';
import { detectPackageManager, startNodeInstall } from '@/core/setup/nodeInstall';
import { checkProviderConnection } from '@/core/setup/providerConnection';
import { canDriveLogin, getLoginRecipe, startProviderLogin } from '@/core/setup/providerLogin';
import { ERROR_LOG_PATH } from '@/core/storage/ErrorLog';
import { DEFAULT_SETTINGS } from '@/core/types/settings';
import { SetupWizardModal } from '@/ui/modals/SetupWizardModal';

const setupStatus = checkProviderSetupStatus as jest.MockedFunction<typeof checkProviderSetupStatus>;
const install = startProviderInstall as jest.MockedFunction<typeof startProviderInstall>;
const detectPm = detectPackageManager as jest.MockedFunction<typeof detectPackageManager>;
const nodeInstall = startNodeInstall as jest.MockedFunction<typeof startNodeInstall>;
const canDrive = canDriveLogin as jest.MockedFunction<typeof canDriveLogin>;
const startLogin = startProviderLogin as jest.MockedFunction<typeof startProviderLogin>;
const recipe = getLoginRecipe as jest.MockedFunction<typeof getLoginRecipe>;
const connection = checkProviderConnection as jest.MockedFunction<typeof checkProviderConnection>;

/**
 * The shared obsidian mock hands back one element for every createEl call, so a
 * queue screen's buttons cannot be told apart on it. This records a real tree
 * instead, which is what clicking through the wizard needs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type El = any;

function makeEl(tag: string, opts: { text?: string; cls?: string } = {}): El {
  const el: El = {
    tag,
    text: opts.text ?? '',
    cls: opts.cls ?? '',
    children: [] as El[],
    handlers: {} as Record<string, Array<() => void>>,
    disabled: false,
    checked: false,
    value: '',
    type: '',
    placeholder: '',
    createEl: (t: string, o?: { text?: string; cls?: string }) => {
      const child = makeEl(t, o);
      el.children.push(child);
      return child;
    },
    createDiv: (o?: { text?: string; cls?: string }) => {
      const child = makeEl('div', o);
      el.children.push(child);
      return child;
    },
    addEventListener: (event: string, fn: () => void) => {
      (el.handlers[event] ??= []).push(fn);
    },
    empty: () => { el.children.length = 0; },
    addClass: () => undefined,
    setText: (t: string) => { el.text = t; },
  };
  return el;
}

function descendants(root: El): El[] {
  return root.children.flatMap((child: El) => [child, ...descendants(child)]);
}

function findByText(root: El, text: string): El | undefined {
  return descendants(root).find((el: El) => el.text === text);
}

function click(el: El | undefined): void {
  expect(el).toBeDefined();
  for (const fn of el?.handlers.click ?? []) fn();
}

function toggle(el: El | undefined, checked: boolean): void {
  expect(el).toBeDefined();
  if (!el) return;
  el.checked = checked;
  for (const fn of el.handlers.change ?? []) fn();
}

/** Let every already-resolved continuation in the queue run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
}

function makeWizard(paths: Record<string, string> = {}) {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => files.get(p) ?? '',
    write: async (p: string, c: string) => { files.set(p, c); },
  };
  const plugin = {
    settings: { ...DEFAULT_SETTINGS, providerCliPaths: { ...paths } },
    manifest: { version: '0.1.16' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    agentService: {
      invalidatePathCache: jest.fn(),
      prewarmCapabilities: jest.fn(),
      redactForLog: (text: string) => text,
    },
    storage: { getAdapter: () => adapter },
    isBashExpansionInFlight: jest.fn(() => false),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wizard: any = new SetupWizardModal(new App(), plugin);
  const root = makeEl('div');
  wizard.contentEl = root;
  return { wizard, plugin, root, files };
}

async function logEntries(files: Map<string, string>): Promise<Array<Record<string, string>>> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return (files.get(ERROR_LOG_PATH) ?? '')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, string>);
}

/** An install that never finishes on its own, plus its resolver. */
type InstallOutcome = { success: boolean; error?: string; cliPath?: string; teardownUnconfirmed?: true };

function pendingInstall() {
  let finish: (r: InstallOutcome) => void = () => undefined;
  const cancel = jest.fn();
  const session = { cancel, done: new Promise<never>((resolve) => { finish = resolve as never; }) };
  return { session, finish: (r: InstallOutcome) => finish(r), cancel };
}

beforeEach(() => {
  jest.clearAllMocks();
  setupStatus.mockReturnValue({ cliFound: false, npmFound: true, status: 'ready' });
  install.mockReturnValue({ cancel: jest.fn(), done: Promise.resolve({ success: true, cliPath: '/usr/local/bin/cli' }) });
  detectPm.mockReturnValue(null);
  nodeInstall.mockReturnValue({ cancel: jest.fn(), done: Promise.resolve({ success: true }) });
  canDrive.mockReturnValue(true);
  recipe.mockReturnValue({ args: ['login'], expectsPastedCode: false });
  connection.mockResolvedValue('connected');
  startLogin.mockReturnValue({
    submitCode: jest.fn(),
    cancel: jest.fn(),
    done: Promise.resolve({ success: true, exitCode: 0, output: '' }),
  });
});

describe('the chooser only starts work when the student confirms', () => {
  it('installs nothing while boxes are being ticked', () => {
    const { wizard, root } = makeWizard();

    wizard.render();
    toggle(descendants(root).find((el: El) => el.cls === 'ocop-setup-choice-box'), true);

    expect(install).not.toHaveBeenCalled();
  });

  it('starts the queue when 설치 시작 is pressed', async () => {
    const { wizard, root } = makeWizard();

    wizard.render();
    const boxes = descendants(root).filter((el: El) => el.cls === 'ocop-setup-choice-box');
    toggle(boxes[1], true); // claude
    click(findByText(root, '설치 시작'));
    await flush();

    expect(install).toHaveBeenCalledWith('claude', expect.any(Function));
  });

  it('runs one queue when 설치 시작 is double-clicked', async () => {
    const { wizard, root } = makeWizard();

    wizard.render();
    const boxes = descendants(root).filter((el: El) => el.cls === 'ocop-setup-choice-box');
    toggle(boxes[1], true);
    const start = findByText(root, '설치 시작');
    // Both handlers fire before the first queue yields.
    click(start);
    click(start);
    await flush();

    expect(install).toHaveBeenCalledTimes(1);
  });

  it('keeps 설치 시작 disabled until something is ticked', () => {
    const { wizard, root } = makeWizard();

    wizard.render();
    const start = findByText(root, '설치 시작');
    expect(start.disabled).toBe(true);

    toggle(descendants(root).filter((el: El) => el.cls === 'ocop-setup-choice-box')[0], true);
    expect(start.disabled).toBe(false);
  });
});

describe('the queue installs one CLI at a time', () => {
  it('does not start the second install until the first finishes', async () => {
    const first = pendingInstall();
    install.mockReturnValueOnce(first.session);
    const { wizard } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();

    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith('claude', expect.any(Function));

    first.finish({ success: true });
    await flush();

    expect(install).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenLastCalledWith('codex', expect.any(Function));
  });

  it('installs Node.js once for a queue, not once per provider', async () => {
    // detectPackageManager is a machine-wide question, so the second entry sees
    // npm on PATH and walks straight past the Node screen.
    let npmFound = false;
    setupStatus.mockImplementation(() => ({ cliFound: false, npmFound, status: 'ready' }));
    detectPm.mockReturnValue({
      id: 'brew', binPath: '/opt/homebrew/bin/brew',
      installArgs: ['install', 'node'], displayCommand: 'brew install node',
    });
    nodeInstall.mockImplementation(() => {
      npmFound = true;
      return { cancel: jest.fn(), done: Promise.resolve({ success: true }) };
    });
    const { wizard, root } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    expect(wizard.phase).toBe('node');

    click(findByText(root, 'Node.js 설치'));
    await flush();

    expect(nodeInstall).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(2);
  });
});

describe('one failure does not take the rest of the queue down', () => {
  it('installs the second CLI after the first fails, and never logs the first in', async () => {
    install
      .mockReturnValueOnce({ cancel: jest.fn(), done: Promise.resolve({ success: false, error: 'npm ERR!' }) })
      .mockReturnValue({ cancel: jest.fn(), done: Promise.resolve({ success: true, cliPath: '/usr/local/bin/codex' }) });
    const { wizard, root } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    expect(wizard.phase).toBe('error');

    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    expect(install).toHaveBeenCalledTimes(2);
    expect(wizard.outcomes.claude.install).toBe('failed');
    expect(wizard.outcomes.codex.install).toBe('ok');
    // The login pass only walks CLIs that are actually on disk.
    expect(wizard.outcomes.claude.login).toBeUndefined();
  });

  it('shows agy its manual screen without blocking the entry behind it', async () => {
    // agy has no install command at all, so the manual screen is its normal path.
    const { wizard, root } = makeWizard();

    void wizard.startQueue(['agy', 'codex']);
    await flush();

    expect(wizard.phase).toBe('manual');
    expect(wizard.current).toBe('agy');
    expect(install).not.toHaveBeenCalled();

    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith('codex', expect.any(Function));
  });
});

describe('a cancelled install still holds the queue', () => {
  it('does not spawn the next npm until the cancelled tree reports its exit', async () => {
    // Sol's countercase: 중지 kills asynchronously, so skipping straight to the
    // next entry could put two `npm install -g` runs on one global prefix.
    const first = pendingInstall();
    install.mockReturnValueOnce(first.session);
    const { wizard, root } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    expect(wizard.phase).toBe('installing');

    click(findByText(root, '중지'));
    expect(first.cancel).toHaveBeenCalled();
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    // The queue has moved on, but the second install is held.
    expect(wizard.current).toBe('codex');
    expect(install).toHaveBeenCalledTimes(1);

    first.finish({ success: false, error: '설치를 취소했습니다.' });
    await flush();

    expect(install).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenLastCalledWith('codex', expect.any(Function));
  });
});

describe('a teardown that could not be confirmed stops the queue', () => {
  it('refuses to spawn the next install and tells the student to restart', async () => {
    // The kill is only signalled; when the process never reports its exit we
    // cannot claim the global prefix is free, so the honest move is to stop
    // rather than start a second package manager over it.
    const first = pendingInstall();
    install.mockReturnValueOnce(first.session);
    const { wizard, root, files } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    click(findByText(root, '중지'));
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    first.finish({ success: false, error: '설치를 취소했습니다.', teardownUnconfirmed: true });
    await flush();

    expect(install).toHaveBeenCalledTimes(1);
    expect(wizard.phase).toBe('error');
    const logged = await logEntries(files);
    expect(logged.filter((e) => e.message.includes('확인하지 못했습니다'))).toHaveLength(1);
  });

  it('records an unconfirmed stop even when no install follows it', async () => {
    // A cancel is a choice and writes nothing. "We asked it to stop and it never
    // said it did" is not a cancel — and on the last entry, or when the student
    // just closes the wizard, nothing else would ever notice.
    const only = pendingInstall();
    install.mockReturnValueOnce(only.session);
    const { wizard, root, files } = makeWizard();

    void wizard.startQueue(['claude']);
    await flush();
    click(findByText(root, '중지'));
    only.finish({ success: false, error: '설치를 취소했습니다.', teardownUnconfirmed: true });
    await flush();

    const logged = await logEntries(files);
    expect(logged.some((e) => e.message.includes('확인하지 못했습니다'))).toBe(true);
  });

  it('records an unconfirmed stop when the student closes the wizard', async () => {
    // Every continuation returns early once the modal is closed, so without an
    // observer attached at close this Windows failure left nothing behind and
    // read exactly like the student changing their mind.
    const running = pendingInstall();
    install.mockReturnValueOnce(running.session);
    const { wizard, files } = makeWizard();

    void wizard.startQueue(['claude']);
    await flush();
    SetupWizardModal.prototype.onClose.call(wizard);
    running.finish({ success: false, error: '설치를 취소했습니다.', teardownUnconfirmed: true });
    await flush();

    const logged = await logEntries(files);
    expect(logged.filter((e) => e.message.includes('확인하지 못했습니다'))).toHaveLength(1);
  });

  it('writes nothing when a closed wizard stopped the install cleanly', async () => {
    const running = pendingInstall();
    install.mockReturnValueOnce(running.session);
    const { wizard, files } = makeWizard();

    void wizard.startQueue(['claude']);
    await flush();
    SetupWizardModal.prototype.onClose.call(wizard);
    running.finish({ success: false, error: '설치를 취소했습니다.' });
    await flush();

    expect(await logEntries(files)).toEqual([]);
  });

  it('writes nothing for a stop the process confirmed', async () => {
    const only = pendingInstall();
    install.mockReturnValueOnce(only.session);
    const { wizard, root, files } = makeWizard();

    void wizard.startQueue(['claude']);
    await flush();
    click(findByText(root, '중지'));
    only.finish({ success: false, error: '설치를 취소했습니다.' });
    await flush();

    expect(await logEntries(files)).toEqual([]);
  });
});

describe('the teardown barrier outlives the entry that waited on it', () => {
  it('still blocks a third provider when the second was skipped mid-wait', async () => {
    // Consuming the barrier on entry let the student stop and skip the screen
    // that was waiting, after which the next entry spawned with no barrier at
    // all — two package managers, which is the thing the queue exists to avoid.
    const first = pendingInstall();
    install.mockReturnValueOnce(first.session);
    const { wizard, root } = makeWizard();

    void wizard.startQueue(['claude', 'codex', 'agy']);
    await flush();
    click(findByText(root, '중지'));
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    // codex is now on the installing screen, waiting on claude's teardown.
    expect(wizard.current).toBe('codex');
    click(findByText(root, '중지'));
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    // agy has no install command, so nothing should have spawned either way —
    // what matters is that the barrier is still there for whoever asks next.
    expect(install).toHaveBeenCalledTimes(1);
    expect(wizard.pendingTeardown).not.toBeNull();
  });

  it('keeps the barrier for good when the stop was never confirmed', async () => {
    const first = pendingInstall();
    install.mockReturnValueOnce(first.session);
    const { wizard, root } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    click(findByText(root, '중지'));
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    first.finish({ success: false, error: '설치를 취소했습니다.', teardownUnconfirmed: true });
    await flush();

    expect(install).toHaveBeenCalledTimes(1);
    // Nothing short of a restart proves that process is gone.
    expect(wizard.pendingTeardown).not.toBeNull();
  });
});

describe('a stale re-check cannot answer for another provider', () => {
  it('runs one probe at a time', async () => {
    // The probe takes seconds and the button stays live, so a student presses
    // 다시 확인 twice.
    const probes: Array<(state: string) => void> = [];
    connection.mockImplementation(() => new Promise((resolve) => { probes.push(resolve as (s: string) => void); }));
    const { wizard, root } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    // Pass 2 opens on claude with its own probe.
    probes[0]('not-connected');
    await flush();
    expect(wizard.phase).toBe('login');

    click(findByText(root, '다시 확인'));
    await flush();
    expect(probes).toHaveLength(2);

    click(findByText(root, '다시 확인'));
    await flush();
    expect(probes).toHaveLength(2);
  });

  it('drops an answer that arrives after the queue moved to another provider', async () => {
    // Without an owner this recorded claude's verdict against codex, which could
    // mark an unusable CLI ready and offer it as the default.
    const answers: Array<(state: string) => void> = [];
    connection.mockImplementation(() => new Promise((resolve) => { answers.push(resolve as (s: string) => void); }));
    const { wizard } = makeWizard();
    wizard.queue = ['claude', 'codex'];
    wizard.current = 'claude';
    wizard.step = 'login';
    wizard.stepDone = () => undefined;
    wizard.plugin.settings.providerCliPaths = { claude: '/opt/claude', codex: '/opt/codex' };

    const pending = wizard.recheck();
    await flush();
    // The queue advances while that probe is still out.
    wizard.current = 'codex';
    answers[0]?.('connected');
    await pending;

    expect(wizard.outcomes.codex?.login).toBeUndefined();
    expect(wizard.outcomes.claude?.login).toBeUndefined();
  });
});

describe('the default provider is chosen once, at the end', () => {
  it('writes selectedProvider only after the last screen is answered', async () => {
    const { wizard, plugin, root } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();

    expect(wizard.phase).toBe('choose-default');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(plugin.settings.selectedProvider).toBe(DEFAULT_SETTINGS.selectedProvider);

    click(findByText(root, 'OpenAI Codex'));
    await flush();

    expect(plugin.settings.selectedProvider).toBe('codex');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(wizard.phase).toBe('done');
  });

  it('takes the first click when two land before the save resolves', async () => {
    // The buttons stay on screen for the whole await, so a double click used to
    // assign twice and leave the persisted default racing the visible one.
    let finishSave: () => void = () => undefined;
    const { wizard, plugin, root } = makeWizard();
    void wizard.startQueue(['claude', 'codex']);
    await flush();
    plugin.saveSettings.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));

    click(findByText(root, 'Claude Code'));
    click(findByText(root, 'OpenAI Codex'));
    await flush();

    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.settings.selectedProvider).toBe('claude');

    finishSave();
    await flush();
    expect(wizard.phase).toBe('done');
  });

  it('puts the old default back when the save is refused', async () => {
    // Otherwise this session runs on the new provider and the next launch runs
    // on the old one, with nothing on screen or in the log saying why.
    const { wizard, plugin, root, files } = makeWizard();
    void wizard.startQueue(['claude', 'codex']);
    await flush();
    plugin.saveSettings.mockRejectedValue(new Error('vault is read-only'));

    click(findByText(root, 'OpenAI Codex'));
    await flush();

    expect(plugin.settings.selectedProvider).toBe(DEFAULT_SETTINGS.selectedProvider);
    expect(wizard.phase).toBe('choose-default');
    const logged = await logEntries(files);
    expect(logged.some((e) => e.stage === 'internal')).toBe(true);
  });

  it('refuses the assignment while a request is in flight', async () => {
    const { wizard, plugin, root } = makeWizard();
    void wizard.startQueue(['claude', 'codex']);
    await flush();
    plugin.isBashExpansionInFlight.mockReturnValue(true);

    click(findByText(root, 'OpenAI Codex'));
    await flush();

    expect(plugin.settings.selectedProvider).toBe(DEFAULT_SETTINGS.selectedProvider);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });
});

describe('the queue writes down the walls it leaves a student at', () => {
  it('records a run that ended with nothing usable', async () => {
    // Every individual failure is already logged; this is the fact that none of
    // them left the student with a working setup, which is what they will ask
    // about tomorrow morning.
    install.mockReturnValue({ cancel: jest.fn(), done: Promise.resolve({ success: false, error: 'npm ERR! EACCES' }) });
    const { wizard, root, files } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    expect(wizard.phase).toBe('choose-default');
    const logged = await logEntries(files);
    // Two install failures plus the summary.
    expect(logged).toHaveLength(3);
    expect(logged[2].stage).toBe('resolve');
    expect(logged[2].message).toContain('install:failed');
  });

  it('records the summary when only some of the queue worked', async () => {
    // One of three working is the case a scattered log cannot explain: the
    // summary is what says which entry the student actually ended up with.
    install
      .mockReturnValueOnce({ cancel: jest.fn(), done: Promise.resolve({ success: false, error: 'npm ERR!' }) })
      .mockReturnValue({ cancel: jest.fn(), done: Promise.resolve({ success: true, cliPath: '/usr/local/bin/codex' }) });
    const { wizard, root, files } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    expect(wizard.phase).toBe('choose-default');
    const summary = (await logEntries(files)).filter((e) => e.stage === 'resolve');
    expect(summary).toHaveLength(1);
    expect(summary[0].message).toContain('일부 CLI가 준비되지 않았습니다');
    expect(summary[0].message).toContain('claude=install:failed');
    expect(summary[0].message).toContain('codex=install:ok');
  });

  it('still records that something failed when the text cannot be redacted', async () => {
    // npm's stderr can echo a configured credential, so with no redactor the
    // text is dropped — but dropping the entry too made a wall look like a
    // clean run, and an empty log is supposed to mean the opposite.
    install.mockReturnValue({ cancel: jest.fn(), done: Promise.resolve({ success: false, error: 'npm ERR! token=abc' }) });
    const { wizard, plugin, files } = makeWizard();
    plugin.agentService.redactForLog = undefined;

    void wizard.startQueue(['claude']);
    await flush();

    const logged = await logEntries(files);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ provider: 'claude', stage: 'install' });
    expect(logged[0].message).not.toContain('token=abc');
  });

  it('writes no summary when every ticked CLI came out ready', async () => {
    const { wizard, files } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();

    expect(wizard.phase).toBe('choose-default');
    expect(await logEntries(files)).toEqual([]);
  });

  it('does not offer a second Node.js install after one already ran', async () => {
    // Windows: a fresh winget install does not reach a running Obsidian's PATH,
    // so npm stays missing and the next entry would run winget over it again.
    setupStatus.mockReturnValue({ cliFound: false, npmFound: false, status: 'needs-node' });
    detectPm.mockReturnValue({
      id: 'winget', binPath: 'winget',
      installArgs: ['install', 'OpenJS.NodeJS.LTS'], displayCommand: 'winget install OpenJS.NodeJS.LTS',
    });
    const { wizard, root, files } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();
    click(findByText(root, 'Node.js 설치'));
    await flush();

    // npm is still missing, so this entry lands on the manual screen.
    expect(wizard.phase).toBe('manual');
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    expect(nodeInstall).toHaveBeenCalledTimes(1);
    expect(wizard.phase).toBe('manual');
    const logged = await logEntries(files);
    expect(logged.some((e) => e.message.includes('Obsidian을 다시 시작'))).toBe(true);
  });
});

describe('a single ticked provider is still a queue', () => {
  it('offers a way out of a login that cannot be finished', async () => {
    // Gating the skip on queue length stranded exactly this student: one
    // provider, a login they cannot complete, and no way to reach the end.
    connection.mockResolvedValue('not-connected');
    const { wizard, root } = makeWizard();

    void wizard.startQueue(['claude']);
    await flush();
    expect(wizard.step).toBe('login');

    click(findByText(root, '건너뛰고 마치기'));
    await flush();

    expect(wizard.phase).toBe('choose-default');
  });

  it('leaves the single-provider wizard path without one', async () => {
    // The `target` path never sets stepDone, so its screens are unchanged.
    connection.mockResolvedValue('not-connected');
    const { wizard, root } = makeWizard();

    await wizard.chooseProvider('claude');
    await wizard.runInstall();

    expect(wizard.phase).toBe('login');
    expect(findByText(root, '건너뛰고 마치기')).toBeUndefined();
    expect(findByText(root, '이건 건너뛰고 다음으로')).toBeUndefined();
  });
});

describe('closing the wizard ends the queue', () => {
  it('cancels the running install and starts nothing after it', async () => {
    const first = pendingInstall();
    install.mockReturnValueOnce(first.session);
    const { wizard } = makeWizard();

    void wizard.startQueue(['claude', 'codex']);
    await flush();

    // The obsidian mock defines onClose as an own jest.fn, which shadows the
    // real one, so close the wizard the way Obsidian would.
    SetupWizardModal.prototype.onClose.call(wizard);
    await flush();

    expect(first.cancel).toHaveBeenCalled();
    expect(install).toHaveBeenCalledTimes(1);
  });
});

describe('each queue entry uses its own CLI path', () => {
  it('drives the login with the path configured for that provider', async () => {
    // configuredCliPath used to read settings.selectedProvider directly, which
    // inside a queue is a third provider entirely.
    connection.mockResolvedValue('not-connected');
    const { wizard, root } = makeWizard({ claude: '/opt/claude', codex: '/opt/codex' });

    void wizard.startQueue(['claude', 'codex']);
    await flush();

    expect(wizard.step).toBe('login');
    expect(wizard.current).toBe('claude');
    click(findByText(root, '로그인 시작'));
    await flush();
    expect(startLogin).toHaveBeenLastCalledWith('claude', expect.any(Function), { cliPath: '/opt/claude' });

    // The login could not be confirmed, so the student moves on by hand.
    click(findByText(root, '이건 건너뛰고 다음으로'));
    await flush();

    expect(wizard.current).toBe('codex');
    click(findByText(root, '로그인 시작'));
    await flush();
    expect(startLogin).toHaveBeenLastCalledWith('codex', expect.any(Function), { cliPath: '/opt/codex' });
  });
});
