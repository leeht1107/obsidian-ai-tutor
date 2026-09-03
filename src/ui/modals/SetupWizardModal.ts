/**
 * SetupWizardModal — first-run setup wizard for students installing via BRAT.
 *
 * Auto-opens when GitHub Copilot CLI is not found.
 * Guides through: auto-install → copilot login → done.
 * Falls back to manual instructions when Node.js / npm is absent.
 */

import { type App,Modal, Notice } from 'obsidian';

import { findProviderCliPath, getProviderDescriptor, type ProviderId } from '../../core/providers/providerRegistry';
import {
  checkProviderSetupStatus,
  installProviderCLI,
  markShownThisSession,
} from '../../core/setup/AutoSetupService';
import type ObsidianCopilotPlugin from '../../main';

type Phase = 'installing' | 'login' | 'done' | 'manual' | 'error';

export class SetupWizardModal extends Modal {
  private phase: Phase = 'installing';
  private installLog: string[] = [];
  private errorDetail = '';

  constructor(app: App, private plugin: ObsidianCopilotPlugin) {
    super(app);
  }

  onOpen() {
    markShownThisSession();
    this.modalEl.addClass('ocop-setup-modal');
    this.setTitle('Obsidian AI Tutor 초기 설정');

    const provider = this.plugin.settings.selectedProvider as ProviderId;
    const { cliFound, npmFound } = checkProviderSetupStatus(provider);

    if (cliFound) {
      // Edge case: CLI appeared between check and open
      this.phase = 'done';
      this.render();
      return;
    }

    if (npmFound && getProviderDescriptor(provider).installCommand) {
      this.phase = 'installing';
      this.render();
      void this.runInstall();
    } else {
      this.phase = 'manual';
      this.render();
    }
  }

  private render() {
    this.contentEl.empty();
    switch (this.phase) {
      case 'installing': this.renderInstalling(); break;
      case 'login':      this.renderLogin();      break;
      case 'done':       this.renderDone();       break;
      case 'manual':     this.renderManual();     break;
      case 'error':      this.renderError();      break;
    }
  }

  // ── Phase: installing ───────────────────────────────────────────────────────

  private renderInstalling() {
    const provider = getProviderDescriptor(this.plugin.settings.selectedProvider as ProviderId);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', {
      text: `📦 ${provider.label} CLI 설치 중...`,
      cls: 'ocop-setup-status',
    });
    const log = wrap.createDiv({ cls: 'ocop-setup-log' });
    for (const line of this.installLog.slice(-6)) {
      log.createDiv({ cls: 'ocop-setup-log-line', text: line });
    }
    if (this.installLog.length === 0) {
      log.createDiv({ cls: 'ocop-setup-log-line ocop-setup-muted', text: `${provider.installCommand} 실행 중...` });
    }
  }

  private async runInstall() {
    const provider = this.plugin.settings.selectedProvider as ProviderId;
    const result = await installProviderCLI(provider, (msg) => {
      if (msg) {
        this.installLog.push(msg);
        if (this.phase === 'installing') this.render();
      }
    });

    if (result.success) {
      // Invalidate the cached null path so the newly installed CLI is found
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
    const provider = getProviderDescriptor(this.plugin.settings.selectedProvider as ProviderId);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });

    wrap.createEl('p', { text: `✅ ${provider.label} CLI 설치 완료!`, cls: 'ocop-setup-success' });
    wrap.createEl('p', {
      text: '마지막으로 터미널에서 아래 명령을 실행해 GitHub 계정을 연결하세요. 대화형 CLI를 먼저 열었다면 /login을 입력해도 됩니다.',
      cls: 'ocop-setup-desc',
    });

    this.renderCmdRow(wrap, provider.loginCommand);

    wrap.createEl('p', {
      text: '브라우저에서 GitHub 로그인이 완료되면 아래 버튼을 누르세요.',
      cls: 'ocop-setup-hint',
    });

    const btn = wrap.createEl('button', { text: '로그인 완료 →', cls: 'mod-cta ocop-setup-action-btn' });
    btn.addEventListener('click', () => {
      this.phase = 'done';
      this.render();
    });
  }

  // ── Phase: done ─────────────────────────────────────────────────────────────

  private renderDone() {
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });
    wrap.createEl('p', {
      text: '🎉 모든 설정이 완료됐습니다!',
      cls: 'ocop-setup-success',
    });
    wrap.createEl('p', {
      text: 'Obsidian AI Tutor 사이드바에서 바로 대화를 시작할 수 있습니다.',
      cls: 'ocop-setup-desc',
    });
    const btn = wrap.createEl('button', { text: '시작하기', cls: 'mod-cta ocop-setup-action-btn' });
    btn.addEventListener('click', () => this.close());
  }

  // ── Phase: manual ───────────────────────────────────────────────────────────

  private renderManual() {
    const provider = getProviderDescriptor(this.plugin.settings.selectedProvider as ProviderId);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });

    wrap.createEl('p', {
      text: `${provider.label} CLI를 설치하고 공식 로그인 절차를 완료하세요.`,
      cls: 'ocop-setup-desc',
    });

    const list = wrap.createEl('ol', { cls: 'ocop-setup-steps' });

    // Step 1 — provider installation
    const s1 = list.createEl('li');
    s1.createSpan({ text: '공식 설치 명령: ' });
    this.renderCmdRow(s1, provider.installCommand ?? provider.command);

    // Step 2 — npm install
    const s2 = list.createEl('li');
    s2.createSpan({ text: '공식 로그인: ' });
    this.renderCmdRow(s2, provider.loginCommand);

    // Step 3 — login
    const s3 = list.createEl('li');
    s3.createSpan({ text: '설치 완료 후 다시 확인하세요.' });

    wrap.createEl('p', {
      text: '설치 완료 후 아래 버튼으로 다시 확인하세요.',
      cls: 'ocop-setup-hint',
    });

    const btn = wrap.createEl('button', { text: '설치 완료 확인', cls: 'mod-cta ocop-setup-action-btn' });
    btn.addEventListener('click', () => {
      if (findProviderCliPath(this.plugin.settings.selectedProvider, this.plugin.settings.providerCliPaths[this.plugin.settings.selectedProvider] || '') || this.plugin.settings.copilotCliPath) {
        this.phase = 'done';
        this.render();
      } else {
        new Notice('CLI를 아직 찾을 수 없습니다. 설치 후 다시 확인해 주세요.');
      }
    });

    const skipBtn = wrap.createEl('button', { text: '나중에', cls: 'ocop-setup-skip-btn' });
    skipBtn.addEventListener('click', () => this.close());
  }

  // ── Phase: error ────────────────────────────────────────────────────────────

  private renderError() {
    const provider = getProviderDescriptor(this.plugin.settings.selectedProvider as ProviderId);
    const wrap = this.contentEl.createDiv({ cls: 'ocop-setup-section' });

    wrap.createEl('p', { text: '⚠️ 자동 설치에 실패했습니다.', cls: 'ocop-setup-warn' });

    if (this.errorDetail) {
      const detail = wrap.createDiv({ cls: 'ocop-setup-log' });
      detail.createDiv({ cls: 'ocop-setup-log-line', text: this.errorDetail });
    }

    wrap.createEl('p', {
      text: '아래 명령을 터미널에서 직접 실행해 주세요.',
      cls: 'ocop-setup-desc',
    });
    this.renderCmdRow(wrap, provider.installCommand ?? provider.command);

    wrap.createEl('p', {
      text: '권한 오류가 계속되면 npm 전역 설치 위치를 사용자 폴더로 바꾸거나 Homebrew 설치를 먼저 고려하세요. sudo는 Mac/Linux에서 마지막 방법으로만 사용하세요.',
      cls: 'ocop-setup-hint',
    });
    this.renderCmdRow(wrap, provider.loginCommand);

    const btn = wrap.createEl('button', { text: '설치 완료 확인', cls: 'mod-cta ocop-setup-action-btn' });
    btn.addEventListener('click', () => {
      if (findProviderCliPath(this.plugin.settings.selectedProvider, this.plugin.settings.providerCliPaths[this.plugin.settings.selectedProvider] || '') || this.plugin.settings.copilotCliPath) {
        this.phase = 'login';
        this.render();
      } else {
        new Notice('CLI를 아직 찾을 수 없습니다. 설치 후 다시 확인해 주세요.');
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private renderCmdRow(parent: HTMLElement, cmd: string) {
    const row = parent.createDiv({ cls: 'ocop-setup-cmd-row' });
    row.createEl('code', { text: cmd, cls: 'ocop-setup-cmd' });
    const btn = row.createEl('button', { text: '복사', cls: 'ocop-setup-copy-btn' });
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(cmd);
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '복사'; }, 1800);
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
