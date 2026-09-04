import { Notice, setIcon } from 'obsidian';
import * as os from 'os';

import {
  allowsEffortWithModel,
  type EffortLevel,
  getProviderEffortLevels,
  getStaticProviderModels,
  type ProviderId,
  type ProviderModelOption,
  supportsEffortSelection,
} from '../../core/providers/providerRegistry';
import type {
  CopilotMcpServer,
  CopilotModel,
  PermissionMode,
  ThinkingBudget,
  UsageInfo,
} from '../../core/types';
import {
  COPILOT_MODELS,
  THINKING_BUDGETS,
} from '../../core/types';
import { CHECK_ICON_SVG, MCP_ICON_SVG } from '../../features/chat/constants';
import type { McpService } from '../../features/mcp/McpService';
import { findConflictingPath } from '../../utils/externalContext';

export interface ToolbarSettings {
  model: CopilotModel;
  selectedProvider: ProviderId;
  thinkingBudget: ThinkingBudget;
  permissionMode: PermissionMode;
  lastNonPlanPermissionMode?: 'agent' | 'ask';
  providerModels?: Partial<Record<ProviderId, string>>;
  providerEfforts?: Partial<Record<ProviderId, string>>;
}

/**
 * Projects plugin settings down to what the toolbar reads. Every provider-scoped key must
 * be listed here: a key omitted from this projection silently reads as `undefined` in the
 * toolbar, so the control renders as unset even though the value is stored and dispatched.
 */
export function toToolbarSettings(settings: {
  model: CopilotModel;
  selectedProvider: ProviderId;
  thinkingBudget: ThinkingBudget;
  permissionMode: PermissionMode;
  lastNonPlanPermissionMode?: 'agent' | 'ask';
  providerModels?: Partial<Record<ProviderId, string>>;
  providerEfforts?: Partial<Record<ProviderId, string>>;
}): ToolbarSettings {
  return {
    model: settings.model,
    selectedProvider: settings.selectedProvider,
    thinkingBudget: settings.thinkingBudget,
    permissionMode: settings.permissionMode,
    lastNonPlanPermissionMode: settings.lastNonPlanPermissionMode,
    providerModels: settings.providerModels,
    providerEfforts: settings.providerEfforts,
  };
}

export interface ToolbarCallbacks {
  onModelChange: (model: CopilotModel) => Promise<void>;
  onProviderModelChange?: (provider: ProviderId, model: string) => Promise<void>;
  onProviderEffortChange?: (provider: ProviderId, effort: string) => Promise<void>;
  getNativeProviderModels?: (provider: Exclude<ProviderId, 'copilot'>) => Promise<ProviderModelOption[]>;
  onThinkingBudgetChange: (budget: ThinkingBudget) => Promise<void>;
  onPermissionModeChange: (mode: PermissionMode) => Promise<void>;
  onOpenQuiz?: () => Promise<void>;
  onOpenSocratic?: () => Promise<void>;
  getSettings: () => ToolbarSettings;
  getEnvironmentVariables?: () => string;
  isAgentInitiatedPlanMode?: () => boolean;
  isPlanModeRequested?: () => boolean;
}

type CostBucket = 'best' | '0x' | '0.33x' | '1x' | '3x';

type ElectronRequire = (moduleName: 'electron') => {
  remote?: {
    dialog: {
      showOpenDialog(options: { properties: string[]; title: string }): Promise<{
        canceled: boolean;
        filePaths: string[];
      }>;
    };
  };
};

function getProviderGroup(model: CopilotModel): string {
  if (model === 'auto') return 'recommended';
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('raptor-')) return 'github';
  return 'other';
}

function getCostOrder(costLabel: string): number {
  const order: Record<CostBucket, number> = {
    best: 0,
    '0x': 1,
    '0.33x': 2,
    '1x': 3,
    '3x': 4,
  };
  return order[(costLabel as CostBucket)] ?? 99;
}

function getProviderOrder(provider: string): number {
  const order: Record<string, number> = {
    recommended: 0,
    openai: 1,
    anthropic: 2,
    google: 3,
    github: 4,
    other: 5,
  };
  return order[provider] ?? 99;
}

function getProviderLabel(provider: string): string {
  const labels: Record<string, string> = {
    recommended: 'recommended',
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'google',
    github: 'github',
    other: 'other',
  };
  return labels[provider] ?? provider;
}

/** Native providers show their own chosen model; Copilot uses the bundled catalog. */
export function getModelSelectorLabel(provider: ProviderId, model: CopilotModel, providerModels?: Partial<Record<ProviderId, string>>): string {
  if (provider !== 'copilot') return providerModels?.[provider]?.trim() || '모델 선택';
  return COPILOT_MODELS.find((option) => option.value === model)?.label ?? COPILOT_MODELS[0].label;
}

export class ModelSelector {
  private container: HTMLElement;
  private buttonEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private nativeModels = new Map<Exclude<ProviderId, 'copilot'>, ProviderModelOption[]>();
  /** Providers whose CLI we actually asked. Absent != empty: the dropdown opens on hover
   *  but discovery runs on click, so without this an un-asked CLI reads as a failed one. */
  private nativeModelsAttempted = new Set<Exclude<ProviderId, 'copilot'>>();
  private nativeModelsLoading = false;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'ocop-model-selector' });
    this.render();
  }

  private getAvailableModels() {
    return [...COPILOT_MODELS];
  }

  private isCopilotSelected(): boolean {
    return this.callbacks.getSettings().selectedProvider === 'copilot';
  }

  private render() {
    this.container.empty();
    this.buttonEl = this.container.createDiv({ cls: 'ocop-model-btn' });
    this.buttonEl.setAttribute('role', 'button');
    this.buttonEl.setAttribute('tabindex', '0');
    this.buttonEl.setAttribute('aria-haspopup', 'listbox');
    this.buttonEl.setAttribute('aria-expanded', 'false');
    this.buttonEl.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = this.buttonEl?.getAttribute('aria-expanded') === 'true';
      this.buttonEl?.setAttribute('aria-expanded', String(!isOpen));
      this.container.toggleClass('is-open', !isOpen);
      this.container.removeClass('is-dismissed');
      if (!isOpen) void this.loadNativeModelsIfNeeded();
    });
    this.buttonEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.buttonEl?.click();
    });
    this.updateDisplay();
    this.dropdownEl = this.container.createDiv({ cls: 'ocop-model-dropdown' });
    this.container.addEventListener('mouseleave', () => this.container.removeClass('is-dismissed'));
    this.renderOptions();
  }

  /**
   * Closes the dropdown after a choice. `is-dismissed` outranks the `:hover` rule so the menu
   * stays shut while the pointer travels across it toward the message box; leaving the
   * selector clears it, so hover-to-open still works the next time.
   */
  private dismiss(): void {
    this.container.removeClass('is-open');
    this.container.addClass('is-dismissed');
    this.buttonEl?.setAttribute('aria-expanded', 'false');
  }

  private async loadNativeModelsIfNeeded(): Promise<void> {
    const provider = this.callbacks.getSettings().selectedProvider;
    if (provider === 'copilot' || this.nativeModels.has(provider) || this.nativeModelsLoading) return;
    const staticModels = getStaticProviderModels(provider);
    if (staticModels.length > 0) {
      this.nativeModelsAttempted.add(provider);
      this.nativeModels.set(provider, [...staticModels]);
      this.renderOptions();
      return;
    }
    if (!this.callbacks.getNativeProviderModels) return;
    this.nativeModelsLoading = true;
    this.renderOptions();
    try {
      this.nativeModels.set(provider, await this.callbacks.getNativeProviderModels(provider));
    } catch {
      this.nativeModels.set(provider, []);
    } finally {
      this.nativeModelsAttempted.add(provider);
      this.nativeModelsLoading = false;
      this.renderOptions();
    }
  }

  updateDisplay() {
    if (!this.buttonEl) return;
    if (!this.isCopilotSelected()) {
      const settings = this.callbacks.getSettings();
      const provider = settings.selectedProvider;
      this.container.style.display = '';
      this.buttonEl.empty();
      this.buttonEl.createSpan({ cls: 'ocop-model-label', text: getModelSelectorLabel(provider, settings.model, settings.providerModels) });
      const effort = this.getActiveEffort(provider);
      if (effort) this.buttonEl.createSpan({ cls: 'ocop-model-effort-badge', text: effort });
      this.buttonEl.setAttribute('aria-label', `${provider} 모델 선택`);
      this.buttonEl.removeAttribute('title');
      this.buttonEl.setAttribute('role', 'button');
      this.buttonEl.setAttribute('tabindex', '0');
      this.buttonEl.setAttribute('aria-haspopup', 'listbox');
      return;
    }
    this.container.style.display = '';
    this.buttonEl.setAttribute('aria-label', '모델 선택');
    this.buttonEl.removeAttribute('title');
    const currentModel = this.callbacks.getSettings().model;
    const models = this.getAvailableModels();
    const modelInfo = models.find((model) => model.value === currentModel) ?? models[0];

    this.buttonEl.empty();
    this.buttonEl.createSpan({ cls: 'ocop-model-label', text: modelInfo?.label || 'Unknown' });
    if (modelInfo?.costLabel) {
      this.buttonEl.createSpan({ cls: 'ocop-model-cost', text: modelInfo.costLabel });
    }
  }

  renderOptions() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();
    if (!this.isCopilotSelected()) {
      this.dropdownEl.removeAttribute('aria-hidden');
      const provider = this.callbacks.getSettings().selectedProvider as Exclude<ProviderId, 'copilot'>;
      const models = this.nativeModels.get(provider) ?? getStaticProviderModels(provider);
      if (this.nativeModelsLoading) {
        this.dropdownEl.createDiv({ cls: 'ocop-model-native-status', text: '설치된 CLI에서 모델을 확인하는 중...' });
      } else if (!this.nativeModelsAttempted.has(provider)) {
        this.dropdownEl.createDiv({ cls: 'ocop-model-native-status', text: `클릭하면 ${provider} CLI에서 사용 가능한 모델을 불러옵니다.` });
      } else if (models.length === 0) {
        this.dropdownEl.createDiv({ cls: 'ocop-model-native-status', text: `${provider} CLI에서 모델 목록을 받지 못했습니다. 아래에 모델 ID를 직접 입력하세요.` });
      } else {
        for (const model of models) this.addNativeModelOption(provider, model);
      }
      this.addNativeModelEntry(provider);
      this.addEffortRow(provider, models);
      return;
    }
    this.dropdownEl.removeAttribute('aria-hidden');

    const currentModel = this.callbacks.getSettings().model;
    const models = [...this.getAvailableModels()].sort((a, b) => {
      const costDiff = getCostOrder(a.costLabel) - getCostOrder(b.costLabel);
      if (costDiff !== 0) return costDiff;
      const providerDiff = getProviderOrder(getProviderGroup(a.value)) - getProviderOrder(getProviderGroup(b.value));
      if (providerDiff !== 0) return providerDiff;
      return a.label.localeCompare(b.label);
    });

    let lastCostLabel: string | null = null;
    let lastProvider: string | null = null;

    for (const model of models) {
      const provider = getProviderGroup(model.value);
      if (model.costLabel !== lastCostLabel) {
        this.dropdownEl.createDiv({ cls: 'ocop-model-section-label', text: model.costLabel });
        lastCostLabel = model.costLabel;
        lastProvider = null;
      }
      if (provider !== lastProvider) {
        this.dropdownEl.createDiv({ cls: 'ocop-model-provider-label', text: getProviderLabel(provider) });
        lastProvider = provider;
      }

      const option = this.dropdownEl.createDiv({ cls: 'ocop-model-option' });
      if (model.value === currentModel) {
        option.addClass('selected');
      }

      const textEl = option.createDiv({ cls: 'ocop-model-option-text' });
      textEl.createSpan({ cls: 'ocop-model-option-label', text: model.label });
      if (model.description) {
        option.setAttribute('title', model.description);
        textEl.createSpan({ cls: 'ocop-model-desc', text: model.description });
      }
      option.createSpan({ cls: 'ocop-model-option-cost', text: model.costLabel });

      option.addEventListener('click', async (event) => {
        event.stopPropagation();
      await this.callbacks.onModelChange(model.value);
        this.dismiss();
        this.updateDisplay();
        this.renderOptions();
      });
    }
  }

  private getActiveEffort(provider: ProviderId): string {
    const stored = this.callbacks.getSettings().providerEfforts?.[provider]?.trim() || '';
    return getProviderEffortLevels(provider).includes(stored as never) ? stored : '';
  }

  private addNativeModelOption(provider: Exclude<ProviderId, 'copilot'>, model: ProviderModelOption): void {
    const selected = (this.callbacks.getSettings().providerModels?.[provider]?.trim() || '') === model.id;
    const option = this.dropdownEl!.createEl('button', { cls: 'ocop-model-option is-native', attr: { type: 'button', 'aria-pressed': String(selected) } });
    if (selected) option.addClass('selected');
    option.createSpan({ cls: 'ocop-model-option-label', text: model.id });
    if (model.label && model.label !== model.id) option.createSpan({ cls: 'ocop-model-option-note', text: model.label });
    option.addEventListener('click', async (event) => {
      event.stopPropagation();
      await this.callbacks.onProviderModelChange?.(provider, model.id);
      // A level the previous model allowed may not exist on this one; drop it rather than
      // carry a combination the CLI or its API would reject on the next send.
      const carried = this.getActiveEffort(provider);
      const incompatible = !allowsEffortWithModel(provider) || !model.efforts.includes(carried as EffortLevel);
      if (carried && incompatible) {
        await this.callbacks.onProviderEffortChange?.(provider, '');
      }
      this.dismiss();
      this.updateDisplay();
      this.renderOptions();
    });
  }

  /**
   * Renders effort only when the installed CLI validated the levels AND the chosen model
   * advertises them. Nothing chosen yet, or an id typed by hand, gets no effort row: we do
   * not know that model's levels, so any chip drawn would be a guess.
   */
  private addEffortRow(provider: Exclude<ProviderId, 'copilot'>, models: readonly ProviderModelOption[]): void {
    if (!supportsEffortSelection(provider)) return;
    const selectedId = this.callbacks.getSettings().providerModels?.[provider]?.trim() || '';

    // Some CLIs cannot take a model and a level together — agy encodes the level in the
    // model id and aborts the run if both are given. There, effort applies to the CLI's
    // own default model, so it is offered only while no model is pinned.
    if (!allowsEffortWithModel(provider)) {
      if (selectedId) {
        this.dropdownEl!.createDiv({ cls: 'ocop-model-native-status', text: `${provider}는 모델 이름에 추론 강도가 포함됩니다. 모델을 선택 해제하면 강도를 따로 지정할 수 있습니다.` });
        return;
      }
      this.renderEffortChips(provider, getProviderEffortLevels(provider));
      return;
    }

    const known = models.find((model) => model.id === selectedId);
    if (!known) {
      if (selectedId) this.dropdownEl!.createDiv({ cls: 'ocop-model-native-status', text: '추론 강도는 위 목록에서 모델을 고르면 표시됩니다.' });
      return;
    }
    const levels = known.efforts.filter((level) => getProviderEffortLevels(provider).includes(level));
    if (levels.length === 0) return;
    this.renderEffortChips(provider, levels);
  }

  private renderEffortChips(provider: Exclude<ProviderId, 'copilot'>, levels: readonly EffortLevel[]): void {
    if (levels.length === 0) return;

    const row = this.dropdownEl!.createDiv({ cls: 'ocop-model-effort-row' });
    row.createSpan({ cls: 'ocop-model-effort-label', text: '추론 강도' });
    const group = row.createDiv({ cls: 'ocop-model-effort-group', attr: { role: 'group', 'aria-label': '추론 강도' } });
    const active = this.getActiveEffort(provider);
    const choices: { value: string; text: string }[] = [{ value: '', text: 'CLI 기본' }, ...levels.map((level) => ({ value: level, text: level }))];
    for (const choice of choices) {
      const isActive = choice.value === active;
      const chip = group.createEl('button', { cls: 'ocop-model-effort-chip', attr: { type: 'button', 'aria-pressed': String(isActive) }, text: choice.text });
      if (isActive) chip.addClass('selected');
      chip.addEventListener('click', async (event) => {
        event.stopPropagation();
        await this.callbacks.onProviderEffortChange?.(provider, choice.value);
        this.dismiss();
        this.updateDisplay();
        this.renderOptions();
      });
    }
  }

  private addNativeModelEntry(provider: Exclude<ProviderId, 'copilot'>): void {
    const input = this.dropdownEl!.createEl('input', { cls: 'ocop-model-direct-input', attr: { type: 'text', placeholder: '모델 ID 직접 입력', 'aria-label': '모델 ID 직접 입력' } });
    input.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter') return;
      event.stopPropagation();
      const model = (input as HTMLInputElement).value.trim();
      if (!model) return;
      await this.callbacks.onProviderModelChange?.(provider, model);
      this.dismiss();
      this.updateDisplay();
      this.renderOptions();
    });
  }
}

export class ThinkingBudgetSelector {
  private container: HTMLElement;
  private gearsEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'ocop-thinking-selector' });
    this.render();
  }

  private isEnabled(): boolean {
    if (this.callbacks.getSettings().selectedProvider !== 'copilot') return false;
    const currentModel = this.callbacks.getSettings().model;
    return COPILOT_MODELS.find((m) => m.value === currentModel)?.supportsReasoning ?? false;
  }

  private render() {
    this.container.empty();
    this.container.createSpan({ cls: 'ocop-thinking-label-text', text: 'Thinking:' });
    this.gearsEl = this.container.createDiv({ cls: 'ocop-thinking-gears' });
    this.updateDisplay();
    this.container.addEventListener('click', () => {
      void this.cycleThinkingBudget();
    });
  }

  private async cycleThinkingBudget() {
    if (!this.isEnabled()) return;
    const levels: ThinkingBudget[] = ['off', 'low', 'medium', 'high'];
    const current = this.callbacks.getSettings().thinkingBudget;
    const currentIndex = levels.indexOf(current);
    const next = levels[(currentIndex + 1) % levels.length];
    await this.callbacks.onThinkingBudgetChange(next);
    this.updateDisplay();
  }

  updateDisplay() {
    if (!this.gearsEl) return;
    this.gearsEl.empty();

    const isCopilot = this.callbacks.getSettings().selectedProvider === 'copilot';
    this.container.style.display = isCopilot ? '' : 'none';
    if (!isCopilot) return;

    if (this.isEnabled()) {
      this.container.removeClass('is-disabled');
    } else {
      this.container.addClass('is-disabled');
    }

    const currentBudget = this.callbacks.getSettings().thinkingBudget;
    const currentBudgetInfo = THINKING_BUDGETS.find((b) => b.value === currentBudget);
    const label = currentBudgetInfo?.label || 'off';
    const cls = currentBudget === 'off'
      ? 'ocop-thinking-current ocop-thinking-disabled'
      : 'ocop-thinking-current ocop-thinking-active';
    this.gearsEl.createDiv({ cls, text: label });
    this.gearsEl.setAttribute('title', this.isEnabled()
      ? 'Click to change thinking level'
      : 'Thinking not available for this model');
  }
}

export class PermissionToggle {
  private container: HTMLElement;
  private toggleEl: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private callbacks: ToolbarCallbacks;
  private onPlanModeToggle: ((active: boolean) => void) | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'ocop-permission-toggle' });
    this.render();
  }

  private render() {
    this.container.empty();
    this.labelEl = this.container.createSpan({ cls: 'ocop-permission-label' });
    this.toggleEl = this.container.createDiv({ cls: 'ocop-toggle-switch' });
    this.updateDisplay();
    this.container.addEventListener('click', () => {
      void this.toggle();
    });
  }

  setOnPlanModeToggle(callback: (active: boolean) => void) {
    this.onPlanModeToggle = callback;
  }

  setPlanModeActive(_active: boolean) {
    this.updateDisplay();
  }

  isPlanModeActive(): boolean {
    return this.isPlanModeLocked() || this.isPlanModeRequested();
  }

  private isPlanModeLocked(): boolean {
    return this.callbacks.getSettings().permissionMode === 'plan';
  }

  private isPlanModeRequested(): boolean {
    return this.callbacks.isPlanModeRequested?.() ?? false;
  }

  updateDisplay() {
    if (!this.toggleEl || !this.labelEl) return;

    this.container.removeClass('plan-mode');
    this.labelEl.empty();

    const mode = this.callbacks.getSettings().permissionMode;
    if (mode === 'plan') {
      this.container.addClass('plan-mode');
      this.toggleEl.removeClass('active');
      const iconEl = this.labelEl.createSpan({ cls: 'ocop-plan-mode-icon' });
      iconEl.textContent = '▎▎';
      iconEl.style.fontSize = '0.8em';
      iconEl.style.letterSpacing = '-4px';
      this.labelEl.createSpan({ text: 'Plan' });
    } else if (mode === 'agent') {
      this.toggleEl.addClass('active');
      this.labelEl.setText('Agent');
    } else {
      this.toggleEl.removeClass('active');
      this.labelEl.setText('Ask');
    }
  }

  private async toggle() {
    const current = this.callbacks.getSettings().permissionMode;
    let next: PermissionMode;

    if (current === 'agent') {
      next = 'plan';
    } else if (current === 'plan') {
      next = 'ask';
    } else {
      next = 'agent';
    }

    await this.callbacks.onPermissionModeChange(next);
    this.updateDisplay();
  }

  async togglePlanMode() {
    if (this.isPlanModeLocked()) {
      new Notice('Plan mode is active until the plan is approved.');
      return;
    }

    this.onPlanModeToggle?.(!this.isPlanModeRequested());
    this.updateDisplay();
  }
}

export class QuizLauncherButton {
  private container: HTMLElement;
  private callbacks: ToolbarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'ocop-quiz-launcher' });
    this.render();
  }

  private render() {
    this.container.empty();
    const button = this.container.createEl('button', {
      cls: 'ocop-quiz-launcher-btn',
      text: '📝 퀴즈',
      attr: { 'aria-label': 'Open guided quiz setup' },
    });
    button.type = 'button';
    button.addEventListener('click', async () => {
      await this.callbacks.onOpenQuiz?.();
    });
  }
}

export class SocraticLauncherButton {
  private container: HTMLElement;
  private callbacks: ToolbarCallbacks;
  private buttonEl: HTMLButtonElement | null = null;

  constructor(parentEl: HTMLElement, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.container = parentEl.createDiv({ cls: 'ocop-socratic-launcher' });
    this.render();
  }

  private render() {
    this.container.empty();
    const button = this.container.createEl('button', {
      cls: 'ocop-socratic-launcher-btn',
      text: '🧠 학습 모드',
      attr: { 'aria-label': '소크라테스 대화 시작', title: '질문 중심 학습 대화로 전환' },
    }) as HTMLButtonElement;
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await this.callbacks.onOpenSocratic?.();
      } finally {
        button.disabled = false;
      }
    });
    this.buttonEl = button;
  }

  setActive(active: boolean): void {
    if (!this.buttonEl) return;
    this.buttonEl.classList.toggle('is-active', active);
    this.buttonEl.textContent = active ? '🧠 학습 중' : '🧠 학습 모드';
  }
}

export class ExternalContextSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private externalContextPaths: string[] = [];
  private onChangeCallback: ((paths: string[]) => void) | null = null;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'ocop-external-context-selector' });
    this.render();
  }

  setOnChange(callback: (paths: string[]) => void): void {
    this.onChangeCallback = callback;
  }

  getExternalContexts(): string[] {
    return [...this.externalContextPaths];
  }

  setExternalContexts(paths: string[]): void {
    this.externalContextPaths = [...paths];
    this.updateDisplay();
    this.renderDropdown();
  }

  clearExternalContexts(): void {
    this.externalContextPaths = [];
    this.updateDisplay();
    this.renderDropdown();
  }

  private render() {
    this.container.empty();

    const iconWrapper = this.container.createDiv({ cls: 'ocop-external-context-icon-wrapper' });
    this.iconEl = iconWrapper.createDiv({ cls: 'ocop-external-context-icon' });
    setIcon(this.iconEl, 'folder');
    this.badgeEl = iconWrapper.createDiv({ cls: 'ocop-external-context-badge' });
    this.updateDisplay();

    iconWrapper.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.openFolderPicker();
    });

    this.dropdownEl = this.container.createDiv({ cls: 'ocop-external-context-dropdown' });
    this.renderDropdown();
  }

  private async openFolderPicker() {
    try {
      const electronRequire = (window as Window & { require?: ElectronRequire }).require;
      const remote = electronRequire?.('electron').remote;
      if (!remote) {
        throw new Error('Electron remote API is not available');
      }
      const result = await remote.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select External Context',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        if (this.externalContextPaths.includes(selectedPath)) {
          return;
        }

        const conflict = findConflictingPath(selectedPath, this.externalContextPaths);
        if (conflict) {
          this.showConflictNotice(selectedPath, conflict);
          return;
        }

        this.externalContextPaths = [...this.externalContextPaths, selectedPath];
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      }
    } catch (error) {
      console.error('Failed to open folder picker:', error);
    }
  }

  private showConflictNotice(newPath: string, conflict: { path: string; type: 'parent' | 'child' }) {
    const shortNew = this.shortenPath(newPath);
    const shortExisting = this.shortenPath(conflict.path);
    const message = conflict.type === 'parent'
      ? `Cannot add "${shortNew}" - it's inside existing path "${shortExisting}"`
      : `Cannot add "${shortNew}" - it contains existing path "${shortExisting}"`;
    new Notice(message, 5000);
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.dropdownEl.empty();

    this.dropdownEl.createDiv({ cls: 'ocop-external-context-header', text: 'External Contexts' });
    const listEl = this.dropdownEl.createDiv({ cls: 'ocop-external-context-list' });

    if (this.externalContextPaths.length === 0) {
      listEl.createDiv({ cls: 'ocop-external-context-empty', text: 'Click folder icon to add' });
      return;
    }

    for (const pathStr of this.externalContextPaths) {
      const itemEl = listEl.createDiv({ cls: 'ocop-external-context-item' });
      const pathTextEl = itemEl.createSpan({ cls: 'ocop-external-context-text' });
      pathTextEl.setText(this.shortenPath(pathStr));
      pathTextEl.setAttribute('title', pathStr);

      const removeBtn = itemEl.createSpan({ cls: 'ocop-external-context-remove' });
      setIcon(removeBtn, 'x');
      removeBtn.setAttribute('title', 'Remove path');
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.externalContextPaths = this.externalContextPaths.filter((entry) => entry !== pathStr);
        this.onChangeCallback?.(this.externalContextPaths);
        this.updateDisplay();
        this.renderDropdown();
      });
    }
  }

  private shortenPath(fullPath: string): string {
    try {
      const homeDir = os.homedir();
      const normalize = (value: string) => value.replace(/\\/g, '/');
      const normalizedFull = normalize(fullPath);
      const normalizedHome = normalize(homeDir);
      const compareFull = process.platform === 'win32' ? normalizedFull.toLowerCase() : normalizedFull;
      const compareHome = process.platform === 'win32' ? normalizedHome.toLowerCase() : normalizedHome;
      if (compareFull.startsWith(compareHome)) {
        return '~' + fullPath.slice(homeDir.length);
      }
    } catch {
      // Ignore errors when getting home directory
    }

    return fullPath;
  }

  updateDisplay() {
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.externalContextPaths.length;
    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} external context${count > 1 ? 's' : ''} (click to add more)`);
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
      return;
    }

    this.iconEl.removeClass('active');
    this.iconEl.setAttribute('title', 'Add external contexts (click)');
    this.badgeEl.removeClass('visible');
  }
}

export class McpServerSelector {
  private container: HTMLElement;
  private iconEl: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private mcpService: McpService | null = null;
  private enabledServers: Set<string> = new Set();
  private onChangeCallback: ((enabled: Set<string>) => void) | null = null;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'ocop-mcp-selector' });
    this.render();
  }

  setMcpService(service: McpService | null): void {
    this.mcpService = service;
    // Default ON: initialize with all globally-enabled servers
    if (service) {
      for (const server of service.getServers()) {
        if (server.enabled) {
          this.enabledServers.add(server.name);
        }
      }
    }
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  setOnChange(callback: (enabled: Set<string>) => void): void {
    this.onChangeCallback = callback;
  }

  getEnabledServers(): Set<string> {
    return new Set(this.enabledServers);
  }

  addMentionedServers(names: Set<string>): void {
    let changed = false;
    for (const name of names) {
      if (!this.enabledServers.has(name)) {
        this.enabledServers.add(name);
        changed = true;
      }
    }
    if (changed) {
      this.updateDisplay();
      this.renderDropdown();
    }
  }

  clearEnabled(): void {
    this.enabledServers.clear();
    this.updateDisplay();
    this.renderDropdown();
  }

  /** Reset to globally-enabled servers (default ON state). */
  resetToDefaults(): void {
    this.enabledServers.clear();
    if (this.mcpService) {
      for (const server of this.mcpService.getServers()) {
        if (server.enabled) {
          this.enabledServers.add(server.name);
        }
      }
    }
    this.updateDisplay();
    this.renderDropdown();
  }

  setEnabledServers(names: string[]): void {
    this.enabledServers = new Set(names);
    this.pruneEnabledServers();
    this.updateDisplay();
    this.renderDropdown();
  }

  private pruneEnabledServers(): void {
    if (!this.mcpService) return;
    // Only remove servers that are no longer configured at all.
    // Globally-disabled servers can still be per-session enabled.
    const configuredNames = new Set(this.mcpService.getServers().map((server) => server.name));
    let changed = false;
    for (const name of this.enabledServers) {
      if (!configuredNames.has(name)) {
        this.enabledServers.delete(name);
        changed = true;
      }
    }
    if (changed) {
      this.onChangeCallback?.(this.enabledServers);
    }
  }

  private render() {
    this.container.empty();
    const iconWrapper = this.container.createDiv({ cls: 'ocop-mcp-selector-icon-wrapper' });
    this.iconEl = iconWrapper.createDiv({ cls: 'ocop-mcp-selector-icon' });
    this.iconEl.innerHTML = MCP_ICON_SVG;
    this.badgeEl = iconWrapper.createDiv({ cls: 'ocop-mcp-selector-badge' });
    this.updateDisplay();
    this.dropdownEl = this.container.createDiv({ cls: 'ocop-mcp-selector-dropdown' });
    this.renderDropdown();
    this.container.addEventListener('mouseenter', () => {
      this.renderDropdown();
    });
  }

  private renderDropdown() {
    if (!this.dropdownEl) return;
    this.pruneEnabledServers();
    this.dropdownEl.empty();
    this.dropdownEl.createDiv({ cls: 'ocop-mcp-selector-header', text: 'MCP Servers' });
    const listEl = this.dropdownEl.createDiv({ cls: 'ocop-mcp-selector-list' });
    const servers = this.mcpService?.getServers() || [];

    if (servers.length === 0) {
      listEl.createDiv({
        cls: 'ocop-mcp-selector-empty',
        text: 'No MCP servers configured',
      });
      return;
    }

    for (const server of servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: CopilotMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'ocop-mcp-selector-item' });
    itemEl.dataset.serverName = server.name;
    const isSessionEnabled = this.enabledServers.has(server.name);
    if (isSessionEnabled) {
      itemEl.addClass('enabled');
    }

    const checkEl = itemEl.createDiv({ cls: 'ocop-mcp-selector-check' });
    if (isSessionEnabled) {
      checkEl.innerHTML = CHECK_ICON_SVG;
    }

    const infoEl = itemEl.createDiv({ cls: 'ocop-mcp-selector-item-info' });
    infoEl.createSpan({ cls: 'ocop-mcp-selector-item-name', text: server.name });

    if (server.contextSaving) {
      const csEl = infoEl.createSpan({ cls: 'ocop-mcp-selector-cs-badge', text: '@' });
      csEl.setAttribute('title', 'Context-saving: can also enable via @' + server.name);
    }

    itemEl.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggleServer(server.name);
    });
  }

  private toggleServer(name: string) {
    if (this.enabledServers.has(name)) {
      this.enabledServers.delete(name);
    } else {
      this.enabledServers.add(name);
    }
    this.updateDisplay();
    this.renderDropdown();
    this.onChangeCallback?.(this.enabledServers);
  }

  updateDisplay() {
    this.pruneEnabledServers();
    if (!this.iconEl || !this.badgeEl) return;

    const count = this.enabledServers.size;
    const hasAnyServers = (this.mcpService?.getServers() || []).length > 0;
    if (!hasAnyServers) {
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = '';
    if (count > 0) {
      this.iconEl.addClass('active');
      this.iconEl.setAttribute('title', `${count} MCP server${count > 1 ? 's' : ''} enabled (click to manage)`);
      if (count > 1) {
        this.badgeEl.setText(String(count));
        this.badgeEl.addClass('visible');
      } else {
        this.badgeEl.removeClass('visible');
      }
      return;
    }

    this.iconEl.removeClass('active');
    this.iconEl.setAttribute('title', 'MCP servers (click to enable)');
    this.badgeEl.removeClass('visible');
  }
}

export class ContextUsageMeter {
  private container: HTMLElement;
  private fillPath: SVGPathElement | null = null;
  private percentEl: HTMLElement | null = null;
  private circumference = 0;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'ocop-context-meter' });
    this.render();
    this.container.style.display = 'none';
  }

  private render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = this.container.createDiv({ cls: 'ocop-context-meter-gauge' });
    gaugeEl.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <path class="ocop-meter-bg"
          d="M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}"
          fill="none" stroke-width="${strokeWidth}" stroke-linecap="round"/>
        <path class="ocop-meter-fill"
          d="M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}"
          fill="none" stroke-width="${strokeWidth}" stroke-linecap="round"
          stroke-dasharray="${this.circumference}" stroke-dashoffset="${this.circumference}"/>
      </svg>
    `;
    this.fillPath = gaugeEl.querySelector('.ocop-meter-fill');
    this.percentEl = this.container.createSpan({ cls: 'ocop-context-meter-percent' });
  }

  update(usage: UsageInfo | null): void {
    if (!usage) {
      this.container.style.display = 'none';
      return;
    }

    const premiumRequests = usage.premiumRequests ?? 0;
    if (usage.contextWindow <= 0) {
      if (premiumRequests <= 0) {
        this.container.style.display = 'none';
        return;
      }

      this.container.style.display = 'flex';
      if (this.fillPath) {
        this.fillPath.style.strokeDashoffset = String(this.circumference);
      }
      if (this.percentEl) {
        this.percentEl.setText(`P ${this.formatPremiumRequests(premiumRequests)}`);
      }
      this.container.removeClass('warning');
      this.container.setAttribute(
        'data-tooltip',
        `Local CLI observed premium usage: ${this.formatPremiumRequests(premiumRequests)} request${premiumRequests === 1 ? '' : 's'}`
      );
      return;
    }

    this.container.style.display = 'flex';
    const fillLength = (usage.percentage / 100) * this.circumference;
    if (this.fillPath) {
      this.fillPath.style.strokeDashoffset = String(this.circumference - fillLength);
    }
    if (this.percentEl) {
      this.percentEl.setText(`${usage.percentage}%`);
    }

    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }

    const tooltip = `Local CLI observed context: ${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)} tokens` +
      (premiumRequests > 0 ? ` • premium usage: ${this.formatPremiumRequests(premiumRequests)} request${premiumRequests === 1 ? '' : 's'}` : '');
    this.container.setAttribute('data-tooltip', tooltip);
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }

  private formatPremiumRequests(requests: number): string {
    if (Number.isInteger(requests)) {
      return String(requests);
    }
    return requests.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
}

export class WebSearchToggle {
  private container: HTMLElement;
  private enabled = false;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'ocop-websearch-toggle' });
    this.render();
  }

  private valueEl: HTMLElement | null = null;

  private render() {
    this.container.empty();
    this.container.createSpan({ cls: 'ocop-thinking-label-text', text: 'Web:' });
    this.valueEl = this.container.createDiv({ cls: 'ocop-thinking-gears' });
    this.updateDisplay();
    this.container.addEventListener('click', () => {
      this.enabled = !this.enabled;
      this.updateDisplay();
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    this.updateDisplay();
  }

  updateDisplay() {
    if (!this.valueEl) return;
    this.valueEl.empty();
    const cls = this.enabled
      ? 'ocop-thinking-current ocop-thinking-active'
      : 'ocop-thinking-current ocop-thinking-disabled';
    this.valueEl.createDiv({ cls, text: this.enabled ? 'on' : 'off' });
    this.container.setAttribute('title', this.enabled
      ? 'Web search on (click to disable)'
      : 'Web search off (click to enable)');
  }
}

export function createInputToolbar(
  parentEl: HTMLElement,
  learningGroupEl: HTMLElement,
  callbacks: ToolbarCallbacks
): {
  primaryToolbarEl: HTMLElement;
  modelSelector: ModelSelector;
  thinkingBudgetSelector: ThinkingBudgetSelector;
  contextUsageMeter: ContextUsageMeter;
  externalContextSelector: ExternalContextSelector;
  webSearchToggle: WebSearchToggle;
  mcpServerSelector: McpServerSelector;
  permissionToggle: PermissionToggle;
  quizLauncherButton: QuizLauncherButton;
  socraticLauncherButton: SocraticLauncherButton;
} {
  const primaryToolbarEl = parentEl.createDiv({ cls: 'ocop-toolbar-primary' });
  const secondaryToolbarEl = parentEl.createDiv({ cls: 'ocop-toolbar-secondary' });
  const modelSelector = new ModelSelector(primaryToolbarEl, callbacks);
  const thinkingBudgetSelector = new ThinkingBudgetSelector(secondaryToolbarEl, callbacks);
  const contextUsageMeter = new ContextUsageMeter(secondaryToolbarEl);
  const externalContextSelector = new ExternalContextSelector(secondaryToolbarEl);
  const webSearchToggle = new WebSearchToggle(secondaryToolbarEl);
  const mcpServerSelector = new McpServerSelector(secondaryToolbarEl);
  const permissionToggle = new PermissionToggle(secondaryToolbarEl, callbacks);
  const quizLauncherButton = new QuizLauncherButton(learningGroupEl, callbacks);
  const socraticLauncherButton = new SocraticLauncherButton(learningGroupEl, callbacks);

  return {
    modelSelector,
    primaryToolbarEl,
    thinkingBudgetSelector,
    contextUsageMeter,
    externalContextSelector,
    webSearchToggle,
    mcpServerSelector,
    permissionToggle,
    quizLauncherButton,
    socraticLauncherButton,
  };
}
