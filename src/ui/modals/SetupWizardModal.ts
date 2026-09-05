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
import type ObsidianCopilotPlugin from '../../main';

/**
 * 'unverified' exists because copilot and agy expose no way to ask whether they
 * are logged in. Sending those students to 'done' would reprint the exact lie
 * this change removed; blocking them at 'login' forever would be worse, since
 * no amount of retrying can produce a confirmation.
 */
type Phase = 'choose' | 'node' | 'installing' | 'login' | 'done' | 'unverified' | 'manual' | 'error';

const MAX_LOG_LINES = 6;

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
    }
  }

  private get provider(): ProviderId {
    return this.plugin.settings.selectedProvider as ProviderId;
  }

  // ── Phase: choose ───────────────────────────────────────────────────────────

  private renderChoose() {
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', { text: '어떤 AI를 사용하시나요?', cls: 'ocop-setup-desc' });
    for (const provider of ['copilot', 'claude', 'codex', 'agy'] as const) {
      const descriptor = getProviderDescriptor(provider);
      const button = wrap.createEl('button', { text: descriptor.label, cls: 'ocop-setup-action-btn' });
      button.addEventListener('click', () => void this.chooseProvider(provider));
    }
  }

  private async chooseProvider(provider: ProviderId) {
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
      this.phase = 'manual';
      this.render();
    });
  }

  private async runNodeInstall() {
    if (this.closed || this.nodeSession) return;
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

    if (!result.success) {
      this.errorDetail = result.error ?? 'Node.js 설치에 실패했습니다.';
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
      this.cliInstallSession = null;
      session?.cancel();
      this.phase = 'manual';
      this.render();
    });
  }

  private async runInstall() {
    if (this.closed || this.cliInstallSession) return;
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
      this.phase = 'login';
    } else {
      this.errorDetail = result.error ?? '알 수 없는 오류';
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
      this.phase = 'done';
    } else if (state === 'unknown' && outcome.success) {
      // The CLI exited cleanly but cannot be asked to confirm. Say exactly that
      // rather than claiming the setup is finished.
      this.phase = 'unverified';
    } else {
      this.loginFailure = outcome.error
        ?? (state === 'not-connected' ? '아직 로그인되지 않았습니다. 다시 시도해 주세요.' : '로그인을 확인하지 못했습니다.');
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

    if (needsNode) {
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
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private renderRecheckButton(parent: HTMLElement) {
    const button = parent.createEl('button', { text: '다시 확인', cls: 'ocop-setup-action-btn' });
    button.addEventListener('click', () => void this.recheck());
  }

  private async recheck() {
    if (!this.hasSelectedProviderCli()) {
      new Notice('CLI를 아직 찾을 수 없습니다. 설치 후 다시 확인해 주세요.');
      return;
    }
    const state = await this.readConnectionState();
    if (this.closed) return;
    // 'unknown' is not success: nothing could answer, so the student is told
    // that instead of being shown a completion screen.
    if (state === 'connected') this.phase = 'done';
    else if (state === 'not-connected') this.phase = 'login';
    else this.phase = 'unverified';
    this.render();
  }

  private configuredCliPath(): string | undefined {
    const provider = this.plugin.settings.selectedProvider;
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
    this.loginSession?.cancel();
    // Otherwise brew, winget or npm keeps installing with no window and no stop.
    this.nodeSession?.cancel();
    this.cliInstallSession?.cancel();
    // A status probe would otherwise keep a CLI running behind a closed window.
    this.probes.abort();
    this.contentEl.empty();
  }
}
