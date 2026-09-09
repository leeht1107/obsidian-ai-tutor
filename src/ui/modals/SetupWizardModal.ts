/**
 * SetupWizardModal — first-run setup for students installing via BRAT.
 *
 * Walks Node.js -> CLI -> login. All three steps are driven from here; the
 * wizard only sends a student to a terminal for agy, which is the one CLI with
 * no login command at all.
 *
 * Evidence is uneven and the code should be read that way: codex's login was
 * captured headlessly from the real binary, claude's is inherited and was never
 * executed here, copilot's is documented from --help only, and the Windows
 * winget path has never run. See
 * .claude/artifacts/provider-model-ux-20260904/install-login-evidence.md
 */

import { type App, Modal, Notice } from 'obsidian';
import * as os from 'os';

import { findProviderCliPath, getProviderDescriptor, type ProviderId } from '../../core/providers/providerRegistry';
import {
  checkProviderSetupStatus,
  type InstallSession,
  markShownThisSession,
  startProviderInstall,
} from '../../core/setup/AutoSetupService';
import {
  detectPackageManager,
  NODE_DOWNLOAD_URL,
  type NodeInstallSession,
  type PackageManager,
  startNodeInstall,
} from '../../core/setup/nodeInstall';
import { checkProviderConnection, type ConnectionState } from '../../core/setup/providerConnection';
import {
  canDriveLogin,
  getLoginRecipe,
  type LoginSession,
  startProviderLogin,
} from '../../core/setup/providerLogin';
import { hasLoginCheck } from '../../core/setup/providerReadiness';
import { type ErrorLogEntry, recordError } from '../../core/storage/ErrorLog';
import type ObsidianCopilotPlugin from '../../main';

/**
 * 'unverified' exists because copilot and agy expose no way to ask whether they
 * are logged in. Sending those students to 'done' would reprint the exact lie
 * this change removed; blocking them at 'login' forever would be worse, since
 * no amount of retrying can produce a confirmation.
 */
type Phase =
  | 'choose' | 'node' | 'installing' | 'login'
  | 'done' | 'unverified' | 'manual' | 'error'
  /** Only reachable from the multi-select queue; the single-provider path never lands here. */
  | 'choose-default';

/** Order the chooser lists providers in, and the order a queue installs them in. */
const PROVIDERS = ['copilot', 'claude', 'codex', 'agy'] as const;

const MAX_LOG_LINES = 6;

/** How much of the on-screen install log travels with a logged failure. */
const LOG_TAIL_LINES = 6;

export class SetupWizardModal extends Modal {
  private phase: Phase = 'choose';
  private installLog: string[] = [];
  private nodeLog: string[] = [];
  private loginLog: string[] = [];
  private errorDetail = '';

  /** Set when the chosen CLI has no login command and a terminal is unavoidable. */
  private manualLoginRequired = false;
  private packageManager: PackageManager | null = null;
  private deviceCode: { url?: string; code?: string } | null = null;
  private loginSession: LoginSession | null = null;
  private loginBusy = false;
  private loginFailure = '';
  /** Set when the student pressed 취소, so the flow does not advance anyway. */
  private loginCancelled = false;
  private nodeSession: NodeInstallSession | null = null;
  /** Aborts in-flight status probes when the wizard closes. */
  private readonly probes = new AbortController();
  private cliInstallSession: InstallSession | null = null;
  /** Kept across re-renders so streaming output cannot wipe what was typed. */
  private pastedCode = '';
  /** Set in onClose; every render and phase change checks it. */
  private closed = false;

  // ── Multi-provider queue ────────────────────────────────────────────────────
  // Only the first-run chooser builds a queue. The `target` path — CLI not found
  // mid-chat, "연결" in Settings — still runs chooseProvider() untouched.

  /** Ticked on the chooser; nothing runs until 설치 시작 is pressed. */
  private readonly selected = new Set<ProviderId>();
  /** The providers the student asked for, in install order. */
  private queue: ProviderId[] = [];
  /** The queue entry currently on screen; null outside a queue. */
  private current: ProviderId | null = null;
  /** Which pass the current entry is in, so a screen knows what finishing means. */
  private step: 'install' | 'login' | null = null;
  private outcomes: Partial<Record<ProviderId, {
    install?: 'ok' | 'failed' | 'manual';
    login?: 'done' | 'unverified' | 'manual-only';
  }>> = {};
  /** Resolves the awaited step so the queue can move to the next provider. */
  private stepDone: (() => void) | null = null;
  /** Guards the one assignment: the buttons stay live while saveSettings runs. */
  private pickingDefault = false;
  /**
   * A cancelled install whose process tree may still be dying.
   *
   * Cancelling only signals the kill, so the next install has to wait for the
   * previous one's own exit or two package managers overlap. In a queue that is
   * two clicks apart — 중지 then 건너뛰기 — rather than a whole wizard session.
   */
  private pendingTeardown: Promise<unknown> | null = null;
  /**
   * Set once a Node.js install has actually run in this wizard.
   *
   * On Windows a fresh winget install does not reach the PATH of an
   * already-running Obsidian, so npm stays missing and every later queue entry
   * would offer to install Node.js again — running winget a second time over
   * the install that just succeeded.
   */
  private nodeInstallRan = false;
  /** The run summary is written once, not on every re-render. */
  private loggedQueueOutcome = false;
  /** One connection probe at a time, so a stale answer cannot settle a later step. */
  private recheckBusy = false;
  /** One queue at a time: a second 설치 시작 would clobber the first one's state. */
  private startingQueue = false;

  /**
   * @param target Provider the student just clicked. Without it the wizard
   * reopens on the chooser and asks a question they already answered.
   */
  constructor(app: App, private plugin: ObsidianCopilotPlugin, private target?: ProviderId) {
    super(app);
  }

  onOpen() {
    markShownThisSession();
    this.modalEl.addClass('ocop-setup-modal');
    this.setTitle('Obsidian AI Tutor 초기 설정');
    if (this.target) { void this.chooseProvider(this.target); return; }
    this.render();
  }

  private render() {
    // A login or install can finish after the student closed the wizard; writing
    // into an emptied modal then throws or resurrects dead UI.
    if (this.closed) return;
    this.contentEl.empty();
    switch (this.phase) {
      case 'choose':     this.renderChoose();     break;
      case 'node':       this.renderNode();       break;
      case 'installing': this.renderInstalling(); break;
      case 'login':      this.renderLogin();      break;
      case 'done':       this.renderDone();       break;
      case 'unverified': this.renderUnverified(); break;
      case 'manual':     this.renderManual();     break;
      case 'error':      this.renderError();      break;
      case 'choose-default': this.renderChooseDefault(); break;
    }
  }

  /**
   * The provider every screen below is about.
   *
   * Inside a queue that is the entry being processed, which is deliberately not
   * the default provider: the queue never writes `selectedProvider`, so reading
   * it here would point every screen at whatever was configured before.
   */
  private get provider(): ProviderId {
    return this.current ?? (this.plugin.settings.selectedProvider as ProviderId);
  }

  // ── Phase: choose ───────────────────────────────────────────────────────────

  private renderChoose() {
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', { text: '어떤 AI를 사용하시나요? 여러 개를 고를 수 있습니다.', cls: 'ocop-setup-desc' });
    for (const provider of PROVIDERS) {
      const row = wrap.createDiv({ cls: 'ocop-setup-choice' });
      const box = row.createEl('input', { cls: 'ocop-setup-choice-box' });
      box.type = 'checkbox';
      box.checked = this.selected.has(provider);
      row.createEl('span', { text: getProviderDescriptor(provider).label, cls: 'ocop-setup-choice-label' });
      box.addEventListener('change', () => {
        if (box.checked) this.selected.add(provider);
        else this.selected.delete(provider);
        // Ticking is not choosing: nothing runs until the button below is pressed.
        start.disabled = this.selected.size === 0;
      });
    }
    const start = wrap.createEl('button', { text: '설치 시작', cls: 'mod-cta ocop-setup-action-btn' });
    start.disabled = this.selected.size === 0;
    start.addEventListener('click', () => { void this.beginQueue(); });
  }

  private async beginQueue(): Promise<void> {
    if (this.startingQueue) return;
    const providers = PROVIDERS.filter((p) => this.selected.has(p));
    if (providers.length === 0) return;
    // The queue itself never assigns selectedProvider, but installing a CLI the
    // student is not currently running is still a change they should not make
    // mid-request unless it is the provider already in use.
    const active = this.plugin.settings.selectedProvider as ProviderId;
    const onlyActive = providers.length === 1 && providers[0] === active;
    if (!onlyActive && this.plugin.isBashExpansionInFlight()) {
      new Notice('실행 중인 작업이 끝날 때까지 provider를 바꿀 수 없습니다.');
      return;
    }
    // A second click would restart the loop over the same fields and orphan the
    // first one's awaited step.
    this.startingQueue = true;
    try {
      await this.startQueue(providers);
    } finally {
      this.startingQueue = false;
    }
  }

  /**
   * Install everything first, then walk the logins one at a time.
   *
   * Splitting the passes separates the waiting (npm) from the parts that need
   * the student's hands (a browser sign-in). Installs are serial because
   * `startProviderInstall` spawns an independent `npm install -g` with no lock
   * anywhere in the module: two at once would have two npms writing the same
   * global prefix. Serialising is the caller's job, which is this modal.
   */
  private async startQueue(providers: readonly ProviderId[]): Promise<void> {
    this.queue = [...providers];
    for (const provider of this.queue) {
      if (this.closed) return;
      this.current = provider;
      this.step = 'install';
      await this.awaitStep(() => this.runInstallStep());
    }
    for (const provider of this.queue) {
      if (this.closed) return;
      // A CLI that failed to install has nothing to log into.
      if (this.outcomes[provider]?.install !== 'ok') continue;
      this.current = provider;
      this.step = 'login';
      await this.awaitStep(() => this.runLoginStep());
    }
    if (this.closed) return;
    this.step = null;
    this.phase = 'choose-default';
    this.render();
  }

  /** Hold the queue until the screen this starts reaches one of its endpoints. */
  private awaitStep(start: () => void | Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      this.stepDone = resolve;
      void start();
    });
  }

  /**
   * Wait for a stopped install to report its exit.
   *
   * Returns false when it never did: the kill was only signalled, so starting
   * another package manager now could put two of them on one global prefix.
   * Saying so on screen is the honest move — the process this plugin cannot see
   * is outside its reach, and a restart is what actually clears it.
   */
  private async awaitTeardown(): Promise<boolean> {
    const pending = this.pendingTeardown;
    if (!pending) return true;
    const result = await pending as { teardownUnconfirmed?: boolean } | undefined;
    const stopped = result?.teardownUnconfirmed !== true;
    // Cleared only by a waiter that still owns it, and only when the stop was
    // confirmed. Clearing on entry let a student stop and skip *this* screen
    // while the wait was in flight, and the entry after it then spawned with no
    // barrier at all; an unconfirmed stop keeps the barrier for good, because
    // nothing short of a restart proves that process is gone.
    if (stopped && this.pendingTeardown === pending) this.pendingTeardown = null;
    return stopped;
  }

  /**
   * Write down a stop that could not be confirmed.
   *
   * A cancel is a choice and is deliberately never logged — but "we asked it to
   * stop and it never said it did" is not a cancel, it is the one Windows
   * failure a macOS walkthrough cannot see. Logging here rather than when the
   * next install is blocked means it is recorded even when nothing follows:
   * the student cancels the last entry, or just closes the wizard.
   */
  private watchTeardown<T extends { teardownUnconfirmed?: boolean }>(
    done: Promise<T>,
    provider: string
  ): Promise<T> {
    return done.then((result) => {
      if (result?.teardownUnconfirmed) {
        this.logSetupFailure(
          provider,
          'install',
          '설치를 중지했지만 프로세스가 끝났다는 것을 확인하지 못했습니다. Obsidian을 다시 시작한 뒤 이어서 진행해 주세요.'
        );
      }
      return result;
    });
  }

  /** Stop the queue at a screen the student can act on. `watchTeardown` logged it. */
  private haltOnUnconfirmedTeardown(): void {
    this.errorDetail = '이전 설치를 완전히 멈추지 못했습니다. Obsidian을 다시 시작한 뒤 이어서 설치해 주세요.';
    this.recordInstall('failed');
    this.phase = 'error';
    this.render();
  }

  private settleStep(): void {
    const done = this.stepDone;
    this.stepDone = null;
    done?.();
  }

  private recordInstall(result: 'ok' | 'failed' | 'manual'): void {
    if (!this.current) return;
    this.outcomes[this.current] = { ...this.outcomes[this.current], install: result };
  }

  private recordLogin(result: 'done' | 'unverified' | 'manual-only'): void {
    if (!this.current) return;
    this.outcomes[this.current] = { ...this.outcomes[this.current], login: result };
  }

  /** Same decision tree as chooseProvider, minus the default-provider assignment. */
  private async runInstallStep(): Promise<void> {
    const provider = this.provider;
    this.installLog = [];
    this.nodeLog = [];
    const { cliFound, npmFound } = checkProviderSetupStatus(provider);
    const descriptor = getProviderDescriptor(provider);

    if (cliFound) {
      this.recordInstall('ok');
      this.settleStep();
      return;
    }
    if (!npmFound) {
      // Node.js is not a per-provider concept: the first entry that installs it
      // makes every later entry see npmFound, so no queue index is special-cased.
      this.packageManager = detectPackageManager();
      if (this.nodeInstallRan) {
        // Node.js was already installed once in this wizard and npm is still not
        // on PATH — on Windows that is the running Obsidian holding a stale
        // environment, and running winget again over it fixes nothing.
        this.logSetupFailure(
          provider,
          'install',
          'Node.js를 설치했는데도 npm이 보이지 않아 이 provider는 직접 설치 안내로 보냈습니다. Obsidian을 다시 시작하면 잡힐 수 있습니다.'
        );
        this.recordInstall('manual');
        this.phase = 'manual';
      } else if (!this.packageManager) {
        this.logSetupFailure(
          provider,
          'install',
          'Node.js도 설치할 수 있는 패키지 관리자도 찾지 못해 직접 설치 안내 화면을 보여줬습니다.'
        );
        this.recordInstall('manual');
        this.phase = 'manual';
      } else {
        this.phase = 'node';
      }
      this.render();
      return;
    }
    if (descriptor.installCommand) {
      this.phase = 'installing';
      this.render();
      void this.runInstall();
      return;
    }
    // agy: no install command to run, so the manual screen is its normal path.
    this.recordInstall('manual');
    this.phase = 'manual';
    this.render();
  }

  private async runLoginStep(): Promise<void> {
    this.manualLoginRequired = false;
    this.loginFailure = '';
    this.loginCancelled = false;
    this.deviceCode = null;
    this.loginLog = [];
    this.pastedCode = '';

    const state = await this.readConnectionState();
    if (this.closed) return;
    if (state === 'connected') {
      this.recordLogin('done');
      this.settleStep();
      return;
    }
    // agy has no login command to drive; the screen says so and waits.
    if (!canDriveLogin(this.provider)) {
      this.manualLoginRequired = true;
      this.recordLogin('manual-only');
    }
    this.phase = 'login';
    this.render();
  }

  /** True when the queue owns this login, so the wizard must not show an end screen. */
  private finishLoginStep(result: 'done' | 'unverified'): boolean {
    if (this.step !== 'login') return false;
    this.recordLogin(result);
    this.settleStep();
    return true;
  }

  // ── Phase: choose-default ───────────────────────────────────────────────────

  /**
   * The one place a queue writes `selectedProvider`.
   *
   * Doing it per entry — which is what chooseProvider does — would silently make
   * whichever CLI happened to be processed last the student's default.
   */
  private renderChooseDefault() {
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    const ready = this.queue.filter((p) => {
      const login = this.outcomes[p]?.login;
      return login === 'done' || login === 'unverified';
    });

    this.logQueueOutcome(ready.length);

    if (ready.length === 0) {
      wrap.createEl('p', { text: '바로 쓸 수 있는 AI가 없습니다', cls: 'ocop-setup-warn' });
      wrap.createEl('p', {
        text: '설치나 로그인을 마친 뒤 설정에서 다시 시도해 주세요.',
        cls: 'ocop-setup-desc',
      });
      const close = wrap.createEl('button', { text: '닫기', cls: 'mod-cta ocop-setup-action-btn' });
      close.addEventListener('click', () => this.close());
      return;
    }

    wrap.createEl('p', { text: '기본으로 사용할 AI를 골라주세요', cls: 'ocop-setup-status' });
    wrap.createEl('p', {
      text: '나머지도 그대로 설치되어 있고, 설정에서 언제든 바꿀 수 있습니다.',
      cls: 'ocop-setup-desc',
    });
    for (const provider of ready) {
      const button = wrap.createEl('button', {
        text: getProviderDescriptor(provider).label,
        cls: 'ocop-setup-action-btn',
      });
      button.addEventListener('click', () => void this.pickDefault(provider));
    }
  }

  /**
   * Write one ordered summary of the run whenever it left something behind.
   *
   * Individual failures are already logged, but scattered: a queue where one of
   * three worked is diagnosed from entries with no ordering and no statement of
   * what the student ended up with. Only a clean run writes nothing.
   */
  private logQueueOutcome(readyCount: number): void {
    if (this.loggedQueueOutcome) return;
    const unfinished = this.queue.some((p) => {
      const outcome = this.outcomes[p];
      if (outcome?.install !== 'ok') return true;
      return outcome.login !== 'done' && outcome.login !== 'unverified';
    });
    if (!unfinished) return;
    this.loggedQueueOutcome = true;
    this.logSetupFailure(
      this.queue.join('+') || 'queue',
      'resolve',
      readyCount === 0
        ? `설치 마법사를 끝까지 진행했지만 사용할 수 있는 CLI가 하나도 없습니다. 결과: ${this.queueSummary()}`
        : `설치 마법사에서 일부 CLI가 준비되지 않았습니다. 결과: ${this.queueSummary()}`
    );
  }

  /** One line naming how far every queue entry got, for the log. */
  private queueSummary(): string {
    return this.queue
      .map((p) => `${p}=install:${this.outcomes[p]?.install ?? 'skipped'},login:${this.outcomes[p]?.login ?? 'skipped'}`)
      .join(' ');
  }

  private async pickDefault(provider: ProviderId): Promise<void> {
    // The same guard chooseProvider carries, for the same reason, sitting on the
    // assignment itself rather than on the screen that leads to it.
    if (provider !== this.plugin.settings.selectedProvider && this.plugin.isBashExpansionInFlight()) {
      new Notice('실행 중인 작업이 끝날 때까지 provider를 바꿀 수 없습니다.');
      return;
    }
    // saveSettings is awaited with every button still on screen, so a second
    // click lands mid-save: two assignments, two saves, and the value that
    // survives the reload is whichever save finishes last rather than the one
    // the student sees on the following screen.
    if (this.pickingDefault) return;
    this.pickingDefault = true;
    const previous = this.plugin.settings.selectedProvider;
    try {
      this.plugin.settings.selectedProvider = provider;
      await this.plugin.saveSettings();
    } catch (error) {
      // The in-memory value would otherwise disagree with the file: the session
      // uses the new provider and the next launch uses the old one.
      this.plugin.settings.selectedProvider = previous;
      const message = '기본으로 쓸 AI를 저장하지 못했습니다. 다시 눌러 주세요.';
      this.logSetupFailure(provider, 'internal', `${message} ${error instanceof Error ? error.message : ''}`.trim());
      new Notice(message);
      return;
    } finally {
      this.pickingDefault = false;
    }
    this.current = null;
    this.phase = 'done';
    this.render();
  }

  private async chooseProvider(provider: ProviderId) {
    // Switching provider while a request is in flight flips the effective permission
    // mode under a child process that is already running, which is how the toolbar
    // ends up displaying Ask while an Agent-flagged CLI writes. The toolbar popover
    // and both Settings entry points refuse it too; this guard sits on the assignment
    // itself so a future caller cannot reintroduce the hole. Re-selecting the SAME
    // provider changes nothing, so the CLI-not-found wizard and the first-run picker
    // still work exactly as before.
    if (provider !== this.plugin.settings.selectedProvider && this.plugin.isBashExpansionInFlight()) {
      new Notice('실행 중인 작업이 끝날 때까지 provider를 바꿀 수 없습니다.');
      return;
    }
    this.plugin.settings.selectedProvider = provider;
    await this.plugin.saveSettings();

    const { cliFound, npmFound } = checkProviderSetupStatus(provider);
    const descriptor = getProviderDescriptor(provider);

    if (cliFound) {
      // The binary existing says nothing about being logged in, so ask the CLI.
      const state = await this.readConnectionState();
      if (this.closed) return;
      if (state === 'connected') this.phase = 'done';
      // Only a check that could not decide at all lands on the warning screen.
      // copilot used to arrive here always, so an installed-but-logged-out
      // student was never offered the login this wizard can actually drive.
      else if (state === 'unknown') this.phase = 'unverified';
      else this.phase = 'login';
    } else if (!npmFound) {
      // Node.js is the missing piece. The plugin can install it on a machine
      // with a package manager instead of handing over a download link.
      this.packageManager = detectPackageManager();
      if (!this.packageManager) {
        // The machine this whole feature was built for: no Node.js and nothing
        // that could install it. The student is shown a download link and the
        // wizard used to record nothing at all, so the one failure most likely
        // to strand somebody left no evidence behind.
        this.logSetupFailure(
          provider,
          'install',
          'Node.js도 설치할 수 있는 패키지 관리자도 찾지 못해 직접 설치 안내 화면을 보여줬습니다.'
        );
      }
      this.phase = this.packageManager ? 'node' : 'manual';
    } else if (descriptor.installCommand) {
      this.phase = 'installing';
      this.render();
      // Not awaited: the wizard re-renders as npm output streams in, so the
      // click handler must return immediately.
      void this.runInstall();
      return;
    } else {
      this.phase = 'manual';
    }
    this.render();
  }

  // ── Phase: node ─────────────────────────────────────────────────────────────

  private renderNode() {
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', { text: 'Node.js가 필요합니다', cls: 'ocop-setup-status' });
    wrap.createEl('p', {
      text: `이 컴퓨터에는 ${this.packageManager?.id ?? '패키지 관리자'}가 있어서 플러그인이 대신 설치할 수 있습니다.`,
      cls: 'ocop-setup-desc',
    });
    if (this.packageManager) this.renderCmdRow(wrap, this.packageManager.displayCommand);

    this.renderLog(wrap, this.nodeLog);

    const running = this.nodeSession !== null;
    const button = wrap.createEl('button', {
      text: running ? '설치 중…' : 'Node.js 설치',
      cls: 'mod-cta ocop-setup-action-btn',
    });
    // Disabling the DOM node is not enough: every progress line re-renders this
    // button, so a second click could start a competing install.
    button.disabled = running;
    button.addEventListener('click', () => { void this.runNodeInstall(); });

    const skip = wrap.createEl('button', { text: '직접 설치할게요', cls: 'ocop-setup-skip-btn' });
    skip.addEventListener('click', () => {
      // Release ownership before cancelling, so the awaited continuation sees a
      // mismatch and leaves this screen alone.
      const session = this.nodeSession;
      this.nodeSession = null;
      session?.cancel();
      if (session) this.pendingTeardown = this.watchTeardown(session.done, 'node');
      this.phase = 'manual';
      this.render();
    });
  }

  private async runNodeInstall() {
    if (this.closed || this.nodeSession) return;
    if (this.pendingTeardown) {
      const stopped = await this.awaitTeardown();
      if (this.closed || this.nodeSession || this.phase !== 'node') return;
      if (!stopped) { this.haltOnUnconfirmedTeardown(); return; }
    }
    const session = startNodeInstall((line) => {
      this.nodeLog.push(line);
      if (this.phase === 'node') this.render();
    }, this.packageManager);
    this.nodeSession = session;
    const result = await session.done;
    // Ownership, not identity of the result: a cancel clears the field first, so
    // a mismatch here means the student already chose another screen and this
    // continuation must not move them off it.
    if (this.closed || this.nodeSession !== session) return;
    this.nodeSession = null;
    if (result.success) this.nodeInstallRan = true;

    if (!result.success) {
      this.errorDetail = result.error ?? 'Node.js 설치에 실패했습니다.';
      if (result.teardownUnconfirmed) {
        this.errorDetail += ' 프로세스가 끝났는지 확인하지 못했으니 Obsidian을 다시 시작해 주세요.';
      }
      this.logSetupFailure('node', 'install', this.errorDetail, this.nodeLog);
      this.recordInstall('failed');
      this.phase = 'error';
      this.render();
      return;
    }

    // npm only appears on PATH after the install, so re-check rather than assume.
    const { npmFound } = checkProviderSetupStatus(this.provider);
    if (npmFound && getProviderDescriptor(this.provider).installCommand) {
      this.phase = 'installing';
      this.render();
      void this.runInstall();
    } else {
      // The Node.js install reported success and npm still is not on PATH. The
      // student is sent to the manual screen having done everything asked of
      // them, which is the hardest kind of failure to diagnose from a
      // description — so it gets an entry, with the install log that led here.
      // A provider that simply has no install command to run is not a failure:
      // the manual screen is that provider's normal path, and logging it would
      // put a non-event in the file.
      if (!npmFound) {
        this.logSetupFailure(
          this.provider,
          'install',
          'Node.js 설치가 끝난 뒤에도 npm을 찾지 못해 직접 설치 안내 화면을 보여줬습니다.',
          this.nodeLog
        );
      }
      this.recordInstall('manual');
      this.phase = 'manual';
      this.render();
    }
  }

  // ── Phase: installing ───────────────────────────────────────────────────────

  private renderInstalling() {
    const descriptor = getProviderDescriptor(this.provider);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', { text: `${descriptor.label} 설치 중…`, cls: 'ocop-setup-status' });
    if (this.installLog.length === 0) {
      wrap.createEl('p', { text: descriptor.installCommand ?? '', cls: 'ocop-setup-hint' });
    }
    this.renderLog(wrap, this.installLog);
    // A stalled npm install would otherwise hold the wizard with no way out.
    const cancel = wrap.createEl('button', { text: '중지', cls: 'ocop-setup-skip-btn' });
    cancel.addEventListener('click', () => {
      const session = this.cliInstallSession;
      const provider = this.provider;
      this.cliInstallSession = null;
      session?.cancel();
      if (session) this.pendingTeardown = this.watchTeardown(session.done, provider);
      this.phase = 'manual';
      this.render();
    });
  }

  private async runInstall() {
    if (this.closed || this.cliInstallSession) return;
    // Only ever async when a cancelled install is still dying: taking the await
    // unconditionally would leave a window where the session this method spawns
    // is not yet owned, so 중지 during it would cancel nothing.
    if (this.pendingTeardown) {
      const stopped = await this.awaitTeardown();
      // 중지 during that wait leaves this screen, and must not be undone by a
      // continuation that spawns npm anyway.
      if (this.closed || this.cliInstallSession || this.phase !== 'installing') return;
      if (!stopped) { this.haltOnUnconfirmedTeardown(); return; }
    }
    const session = startProviderInstall(this.provider, (msg) => {
      if (!msg) return;
      this.installLog.push(msg);
      if (this.phase === 'installing') this.render();
    });
    this.cliInstallSession = session;
    const result = await session.done;
    // Ignore a result from an install this modal no longer owns.
    if (this.closed || this.cliInstallSession !== session) return;
    this.cliInstallSession = null;

    if (result.success) {
      // Drop the cached null path so the CLI just installed is actually found.
      this.plugin.agentService.invalidatePathCache();
      void this.plugin.agentService.prewarmCapabilities();
      if (this.step === 'install') {
        // The queue logs everything in after the last install finishes.
        this.recordInstall('ok');
        this.settleStep();
        return;
      }
      this.phase = 'login';
    } else {
      this.errorDetail = result.error ?? '알 수 없는 오류';
      if (result.teardownUnconfirmed) {
        this.errorDetail += ' 프로세스가 끝났는지 확인하지 못했으니 Obsidian을 다시 시작해 주세요.';
      }
      this.logSetupFailure(this.provider, 'install', this.errorDetail, this.installLog);
      this.recordInstall('failed');
      this.phase = 'error';
    }
    this.render();
  }

  // ── Phase: login ────────────────────────────────────────────────────────────

  private renderLogin() {
    const descriptor = getProviderDescriptor(this.provider);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', { text: `${descriptor.label} 로그인`, cls: 'ocop-setup-status' });

    if (this.manualLoginRequired) {
      // agy only: there is no login subcommand to drive.
      wrap.createEl('p', {
        text: `${descriptor.label}에는 플러그인이 실행할 수 있는 로그인 명령이 없습니다. 터미널에서 직접 로그인해 주세요.`,
        cls: 'ocop-setup-desc',
      });
      this.renderCmdRow(wrap, descriptor.loginCommand);
      this.renderRecheckButton(wrap);
      this.renderSkipStepButton(wrap);
      return;
    }

    if (this.deviceCode?.code || this.deviceCode?.url) {
      if (this.deviceCode.code) {
        wrap.createEl('p', {
          text: '아래 페이지를 열고 이 코드를 입력하세요.',
          cls: 'ocop-setup-desc',
        });
        wrap.createDiv({ cls: 'ocop-setup-device-code', text: this.deviceCode.code });
      } else {
        // A paste-back CLI prints only the link; the browser supplies the code.
        wrap.createEl('p', {
          text: '아래 페이지에서 로그인한 뒤, 화면에 나오는 코드를 밑에 붙여넣으세요.',
          cls: 'ocop-setup-desc',
        });
      }
      if (this.deviceCode.url) {
        const open = wrap.createEl('button', { text: '페이지 열기', cls: 'mod-cta ocop-setup-action-btn' });
        const url = this.deviceCode.url;
        open.addEventListener('click', () => { window.open(url, '_blank'); });
        this.renderCmdRow(wrap, url);
      }
    } else if (this.loginBusy) {
      wrap.createEl('p', { text: '브라우저 인증을 준비하는 중…', cls: 'ocop-setup-desc' });
    } else {
      wrap.createEl('p', {
        text: '아래 버튼을 누르면 이 창에서 로그인을 진행합니다. 터미널은 필요 없습니다.',
        cls: 'ocop-setup-desc',
      });
    }

    if (this.loginFailure) {
      wrap.createEl('p', { text: this.loginFailure, cls: 'ocop-setup-warn' });
    }

    this.renderLog(wrap, this.loginLog);

    // Some CLIs hand the browser's code back to the student to paste in.
    if (this.loginBusy && getLoginRecipe(this.provider)?.expectsPastedCode) {
      const row = wrap.createDiv({ cls: 'ocop-setup-cmd-row' });
      const input = row.createEl('input', { cls: 'ocop-setup-code-input' });
      input.placeholder = '브라우저에서 받은 코드';
      // The CLI keeps printing while the student types, and each line re-renders
      // this row, so the value has to survive outside the element.
      input.value = this.pastedCode;
      input.addEventListener('input', () => { this.pastedCode = input.value; });
      const submit = row.createEl('button', { text: '코드 입력', cls: 'mod-cta ocop-setup-copy-btn' });
      submit.addEventListener('click', () => {
        if (!this.pastedCode.trim()) return;
        this.loginSession?.submitCode(this.pastedCode);
        this.pastedCode = '';
        input.value = '';
      });
    }

    if (!this.loginBusy) {
      const start = wrap.createEl('button', { text: '로그인 시작', cls: 'mod-cta ocop-setup-action-btn' });
      start.addEventListener('click', () => void this.beginLogin());
      this.renderRecheckButton(wrap);
      this.renderSkipStepButton(wrap);
    } else {
      const cancel = wrap.createEl('button', { text: '취소', cls: 'ocop-setup-skip-btn' });
      cancel.addEventListener('click', () => {
        this.loginCancelled = true;
        this.loginSession?.cancel();
      });
    }
  }

  /**
   * Run the CLI's own login and confirm the result with a status check.
   *
   * The CLI exiting 0 is not treated as proof on its own — that is the mistake
   * the old readiness badge made.
   */
  private async beginLogin() {
    if (!canDriveLogin(this.provider)) {
      this.manualLoginRequired = true;
      this.render();
      return;
    }

    this.loginBusy = true;
    this.loginFailure = '';
    this.loginCancelled = false;
    this.deviceCode = null;
    this.loginLog = [];
    this.render();

    const session = startProviderLogin(this.provider, (event) => {
      if (event.type === 'device-code') {
        this.deviceCode = { url: event.url, code: event.code };
        // Save the click: the student still sees the URL and can reopen it.
        if (event.url) window.open(event.url, '_blank');
      } else if (event.text.trim()) {
        this.loginLog.push(event.text.trim());
      }
      if (this.phase === 'login') this.render();
    }, { cliPath: this.configuredCliPath() });

    this.loginSession = session;
    const outcome = await session.done;
    this.loginBusy = false;
    this.loginSession = null;
    // Closing or cancelling must not leave a status probe running behind it.
    if (this.closed) return;
    if (this.loginCancelled) {
      // The student stopped this on purpose; advancing anyway would override it.
      this.loginFailure = '로그인을 취소했습니다.';
      this.render();
      return;
    }

    const state = await this.readConnectionState();
    if (this.closed) return;
    if (state === 'connected') {
      if (this.finishLoginStep('done')) return;
      this.phase = 'done';
    } else if (state === 'unknown' && outcome.success) {
      // The CLI exited cleanly but cannot be asked to confirm. Say exactly that
      // rather than claiming the setup is finished.
      if (this.finishLoginStep('unverified')) return;
      this.phase = 'unverified';
    } else {
      this.loginFailure = outcome.error
        ?? (state === 'not-connected' ? '아직 로그인되지 않았습니다. 다시 시도해 주세요.' : '로그인을 확인하지 못했습니다.');
      // The login log is deliberately not attached. A device-auth login prints a
      // verification code and a session-bearing URL, and neither was ever
      // configured anywhere, so redaction cannot see them. The summary says what
      // failed; the CLI's own output is not worth handing to a third party.
      this.logSetupFailure(this.provider, 'login', this.loginFailure);
    }
    this.render();
  }

  /**
   * Ask whether this provider is usable, by whatever means it allows.
   *
   * Deliberately the connection check, not the login probe. copilot has no
   * status command, so the probe could only ever answer 'unknown' — which sent
   * a student who had just logged in to a screen saying the login could not be
   * confirmed, with a command to copy into a terminal. copilot stores its token
   * in the system credential store (`copilot login --help`), so on macOS the
   * credential check answers this properly.
   */
  private async readConnectionState(): Promise<ConnectionState> {
    return checkProviderConnection(this.provider, {
      cliPath: this.configuredCliPath(),
      signal: this.probes.signal,
    });
  }

  // ── Phase: done ─────────────────────────────────────────────────────────────

  private renderDone() {
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', { text: '준비가 끝났습니다', cls: 'ocop-setup-success' });
    wrap.createEl('p', {
      text: '사이드바에서 바로 대화를 시작할 수 있습니다.',
      cls: 'ocop-setup-desc',
    });
    const button = wrap.createEl('button', { text: '시작하기', cls: 'mod-cta ocop-setup-action-btn' });
    button.addEventListener('click', () => this.close());
  }

  private renderUnverified() {
    const descriptor = getProviderDescriptor(this.provider);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', { text: '로그인 여부를 확인할 수 없습니다', cls: 'ocop-setup-warn' });
    // Two different situations reach here and they need different advice.
    wrap.createEl('p', {
      text: hasLoginCheck(this.provider)
        ? `${descriptor.label}의 로그인 상태를 확인하는 명령이 응답하지 않았습니다. 잠시 후 다시 확인해 보세요.`
        // copilot: macOS reads the keychain, so reaching here means this
        // machine keeps its credentials somewhere this plugin cannot read yet.
        : `이 컴퓨터에서는 ${descriptor.label}의 로그인 여부를 확인할 방법이 없습니다. 로그인을 이미 마쳤다면 그대로 시작하시고, 인증 오류가 나면 아래 명령으로 로그인해 주세요.`,
      cls: 'ocop-setup-desc',
    });
    this.renderCmdRow(wrap, descriptor.loginCommand);
    const start = wrap.createEl('button', { text: '그래도 시작하기', cls: 'mod-cta ocop-setup-action-btn' });
    start.addEventListener('click', () => this.close());
    this.renderRecheckButton(wrap);
  }

  // ── Phase: manual ───────────────────────────────────────────────────────────

  private renderManual() {
    const descriptor = getProviderDescriptor(this.provider);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    const needsNode = !checkProviderSetupStatus(this.provider).npmFound;

    if (needsNode && this.nodeInstallRan) {
      // Windows: the install worked, but a running Obsidian keeps the PATH it
      // started with. Telling this student to go download Node.js sends them to
      // repeat the thing that already succeeded; the restart is the fix, and it
      // belongs on screen rather than only in the log.
      wrap.createEl('p', { text: 'Obsidian을 다시 시작해 주세요', cls: 'ocop-setup-status' });
      wrap.createEl('p', {
        text: 'Node.js 설치는 끝났지만, 지금 실행 중인 Obsidian은 예전 설정을 그대로 쓰고 있어서 아직 찾지 못합니다. Obsidian을 껐다 켠 뒤 이 설정을 다시 열어주세요.',
        cls: 'ocop-setup-desc',
      });
    } else if (needsNode) {
      wrap.createEl('p', { text: 'Node.js를 먼저 설치해 주세요', cls: 'ocop-setup-status' });
      wrap.createEl('p', {
        text: '이 컴퓨터에는 자동으로 설치할 수 있는 패키지 관리자가 없어서, 설치 페이지를 열어 드립니다.',
        cls: 'ocop-setup-desc',
      });
      const open = wrap.createEl('button', { text: 'nodejs.org 열기', cls: 'mod-cta ocop-setup-action-btn' });
      open.addEventListener('click', () => { window.open(NODE_DOWNLOAD_URL, '_blank'); });
    } else {
      wrap.createEl('p', {
        text: `${descriptor.label}는 공식 안내대로 직접 설치해야 합니다.`,
        cls: 'ocop-setup-desc',
      });
      this.renderCmdRow(wrap, descriptor.installCommand ?? descriptor.command);
    }

    this.renderRecheckButton(wrap);
    this.renderSkipStepButton(wrap);
    const skip = wrap.createEl('button', { text: '나중에', cls: 'ocop-setup-skip-btn' });
    skip.addEventListener('click', () => this.close());
  }

  // ── Phase: error ────────────────────────────────────────────────────────────

  private renderError() {
    const descriptor = getProviderDescriptor(this.provider);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', { text: '설치에 실패했습니다', cls: 'ocop-setup-warn' });
    if (this.errorDetail) this.renderLog(wrap, [this.errorDetail]);
    wrap.createEl('p', { text: '아래 명령을 터미널에서 직접 실행해 주세요.', cls: 'ocop-setup-desc' });
    this.renderCmdRow(wrap, descriptor.installCommand ?? descriptor.command);
    this.renderRecheckButton(wrap);
    this.renderSkipStepButton(wrap);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private renderRecheckButton(parent: HTMLElement) {
    const button = parent.createEl('button', { text: '다시 확인', cls: 'ocop-setup-action-btn' });
    button.addEventListener('click', () => void this.recheck());
  }

  /**
   * Let the student abandon one queue entry without abandoning the rest.
   *
   * A single-provider wizard has nothing to move on to, so its screens keep the
   * exact wording they have today.
   */
  private renderSkipStepButton(parent: HTMLElement) {
    // `stepDone` is set only while a queue owns the screen, so the untouched
    // single-provider path never grows this button. Gating on queue length
    // instead used to strand a student who ticked exactly one provider: a login
    // they cannot finish had no way forward and no default was ever written.
    if (!this.stepDone) return;
    const label = this.queue.length > 1 ? '이건 건너뛰고 다음으로' : '건너뛰고 마치기';
    const button = parent.createEl('button', { text: label, cls: 'ocop-setup-skip-btn' });
    // A skip is a choice, not a wall: like 취소, it writes no failure entry.
    button.addEventListener('click', () => this.settleStep());
  }

  private async recheck() {
    // The probe takes seconds and the button stays live, so a student presses it
    // twice. Without an owner the second answer lands after the queue has moved
    // on and records provider A's verdict against provider B — which could mark
    // an unusable CLI ready and offer it as the default.
    if (this.recheckBusy) return;
    if (!this.hasSelectedProviderCli()) {
      const message = 'CLI를 아직 찾을 수 없습니다. 설치 후 다시 확인해 주세요.';
      this.logSetupFailure(this.provider, 'resolve', message);
      new Notice(message);
      return;
    }
    const owner = this.current;
    const step = this.step;
    this.recheckBusy = true;
    let state: ConnectionState;
    try {
      state = await this.readConnectionState();
    } finally {
      this.recheckBusy = false;
    }
    if (this.closed) return;
    if (this.current !== owner || this.step !== step) return;
    // 'unknown' is not success: nothing could answer, so the student is told
    // that instead of being shown a completion screen.
    if (state === 'connected') this.phase = 'done';
    else if (state === 'not-connected') this.phase = 'login';
    else this.phase = 'unverified';
    // Inside a queue the same check also ends the step it was pressed on: the
    // CLI is now on disk, and the login pass runs after every install.
    if (this.step === 'install') {
      this.recordInstall('ok');
      this.settleStep();
      return;
    }
    if (this.step === 'login' && state !== 'not-connected') {
      this.recordLogin(state === 'connected' ? 'done' : 'unverified');
      this.settleStep();
      return;
    }
    this.render();
  }

  /**
   * Write down a setup failure the student was just shown.
   *
   * This is the seam, rather than the setup services themselves, because those
   * also run background probes whose failures nobody sees. Logging inside them
   * would fill the file with noise and cost the log its meaning: today, an entry
   * here means the student hit a wall on screen, and an empty file means they
   * did not. A cancel is not a failure and is deliberately not logged.
   *
   * npm and winget put the real cause in their last few lines, so the tail of the
   * on-screen log is carried along with the summary sentence.
   */
  private logSetupFailure(
    provider: string,
    stage: ErrorLogEntry['stage'],
    summary: string,
    log: readonly string[] = []
  ): void {
    // Everything is inside the guard, including the arguments: they are
    // evaluated before recordError's own try is entered, and a wizard that
    // crashes while recording an install failure is worse than one that
    // records nothing.
    try {
      // Redaction is the log's contract, not an optimisation. The bridge owns the
      // pattern, and everything below carries third-party text: `summary` can be
      // npm's own stderr, which is exactly what can echo a configured
      // credential. So with no bridge to ask, the text is dropped — but the fact
      // that the student was blocked here is not. Losing the entry entirely made
      // a wall look like a clean run, which is the one thing this file must never
      // report.
      const redact = this.plugin.agentService?.redactForLog?.bind(this.plugin.agentService);
      if (!redact) {
        recordError(
          this.plugin.storage?.getAdapter?.(),
          { provider, stage, message: '설치 중 문제가 발생했지만, 내용을 안전하게 정리할 수 없어 기록하지 못했습니다.' },
          { home: os.homedir(), pluginVersion: this.plugin.manifest?.version ?? 'unknown' }
        );
        return;
      }
      const tail = log.slice(-LOG_TAIL_LINES).join('\n');
      recordError(
        this.plugin.storage?.getAdapter?.(),
        {
          provider,
          stage,
          message: redact(tail ? `${summary}\n${tail}` : summary),
          cliPath: this.configuredCliPath(),
        },
        { home: os.homedir(), pluginVersion: this.plugin.manifest?.version ?? 'unknown' }
      );
    } catch { /* never break the wizard to write a log line */ }
  }

  private configuredCliPath(): string | undefined {
    // this.provider, not the default: inside a queue those differ, and reading
    // the default here would log in and probe with another CLI's path.
    const provider = this.provider;
    return this.plugin.settings.providerCliPaths?.[provider]
      || (provider === 'copilot' ? this.plugin.settings.copilotCliPath : '')
      || undefined;
  }

  private hasSelectedProviderCli(): boolean {
    return findProviderCliPath(this.provider, this.configuredCliPath()) !== null;
  }

  private renderLog(parent: HTMLElement, lines: readonly string[]) {
    if (lines.length === 0) return;
    const log = parent.createDiv({ cls: 'ocop-setup-log' });
    for (const line of lines.slice(-MAX_LOG_LINES)) {
      log.createDiv({ cls: 'ocop-setup-log-line', text: line });
    }
  }

  private renderCmdRow(parent: HTMLElement, cmd: string) {
    const row = parent.createDiv({ cls: 'ocop-setup-cmd-row' });
    row.createEl('code', { text: cmd, cls: 'ocop-setup-cmd' });
    const button = row.createEl('button', { text: '복사', cls: 'ocop-setup-copy-btn' });
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(cmd);
      button.textContent = '✓';
      setTimeout(() => { button.textContent = '복사'; }, 1800);
    });
  }

  onClose() {
    this.closed = true;
    // Without this the queue stays parked on an await and starts the next
    // provider after the window is gone.
    this.settleStep();
    this.loginSession?.cancel();
    // Watch before cancelling: every continuation below returns early once
    // `closed` is set, so without an observer here a stop whose exit was never
    // confirmed — the Windows failure this log exists for — would leave nothing
    // behind, and read exactly like the student changing their mind.
    if (this.nodeSession) void this.watchTeardown(this.nodeSession.done, 'node');
    if (this.cliInstallSession) void this.watchTeardown(this.cliInstallSession.done, this.provider);
    // Otherwise brew, winget or npm keeps installing with no window and no stop.
    this.nodeSession?.cancel();
    this.cliInstallSession?.cancel();
    // A status probe would otherwise keep a CLI running behind a closed window.
    this.probes.abort();
    this.contentEl.empty();
  }
}
