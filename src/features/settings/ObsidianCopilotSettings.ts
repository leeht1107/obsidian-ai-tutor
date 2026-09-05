import * as fs from 'fs';
import type { App } from 'obsidian';
import { Notice, PluginSettingTab, setIcon,Setting } from 'obsidian';

import { defaultModelSource, getProviderDescriptor, getStaticProviderModels, type ProviderId, type ProviderModelOption,PROVIDERS, storeDefaultModel } from '../../core/providers/providerRegistry';
import { checkProviderConnection, connectionLabel, resolveCheckedState } from '../../core/setup/providerConnection';
import { getCurrentPlatformKey } from '../../core/types';
import { COPILOT_MODELS } from '../../core/types/models';
import type ObsidianCopilotPlugin from '../../main';
import { EnvSnippetManager, SlashCommandSettings } from '../../ui';
import { setupCollapsible } from '../../ui/utils/collapsible';
import { expandHomePath } from '../../utils/path';
import {
  getInstalledSkills,
  installObsidianSkills,
  installSkillFromUrl,
  isMachineWideSkillsRoot,
  isObsidianSkillsInstalled,
  removeSkill,
  uninstallObsidianSkills,
} from '../skills/ObsidianSkillsInstaller';
import { buildNavMappingText, parseNavMappings } from './keyboardNavigation';

function formatHotkey(hotkey: { modifiers: string[]; key: string }): string {
  const isMac = navigator.platform.includes('Mac');
  const modMap: Record<string, string> = isMac
    ? { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
    : { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win' };

  const mods = hotkey.modifiers.map((modifier) => modMap[modifier] || modifier);
  const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
  return isMac ? [...mods, key].join('') : [...mods, key].join('+');
}

interface ObsidianAppInternals {
  setting?: {
    open: () => void;
    openTabById: (id: string) => void;
    activeTab?: {
      searchInputEl?: HTMLInputElement;
      searchComponent?: { inputEl?: HTMLInputElement };
      updateHotkeyVisibility?: () => void;
    };
  };
  hotkeyManager?: {
    customKeys?: Record<string, Array<{ modifiers: string[]; key: string }>>;
    defaultKeys?: Record<string, Array<{ modifiers: string[]; key: string }>>;
  };
}

function openHotkeySettings(app: App): void {
  const setting = (app as unknown as ObsidianAppInternals).setting;
  if (!setting) return;
  setting.open();
  setting.openTabById('hotkeys');
  setTimeout(() => {
    const tab = setting.activeTab;
    if (!tab) return;
    const searchEl = tab.searchInputEl ?? tab.searchComponent?.inputEl;
    if (!searchEl) return;
    searchEl.value = 'Obsidian AI Tutor';
    tab.updateHotkeyVisibility?.();
  }, 100);
}

function getHotkeyForCommand(app: App, commandId: string): string | null {
  const hotkeyManager = (app as unknown as ObsidianAppInternals).hotkeyManager;
  if (!hotkeyManager) return null;

  const customHotkeys = hotkeyManager.customKeys?.[commandId];
  const defaultHotkeys = hotkeyManager.defaultKeys?.[commandId];
  const hotkeys = customHotkeys && customHotkeys.length > 0 ? customHotkeys : defaultHotkeys;
  if (!hotkeys || hotkeys.length === 0) return null;
  return hotkeys.map(formatHotkey).join(', ');
}

export class ObsidianCopilotSettingTab extends PluginSettingTab {
  plugin: ObsidianCopilotPlugin;
  /**
   * Cancels the connection checks of the previous render. display() re-runs on
   * every provider switch and whenever the wizard closes, and without this each
   * render leaves four CLIs running against rows that no longer exist.
   */
  private probes = new AbortController();

  constructor(app: App, plugin: ObsidianCopilotPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * One provider's install-and-login row.
   *
   * The stored state is drawn first so the row is never blank, then the live
   * check replaces it. Every check here is free: three CLIs answer a status
   * command, and copilot is decided by whether a credential exists.
   */
  private renderProviderConnectionRow(containerEl: HTMLElement, providerId: ProviderId): void {
    const descriptor = getProviderDescriptor(providerId);
    // The legacy copilotCliPath setting still holds the path for upgraded
    // installs; ignoring it reports an installed copilot as not connected.
    // Optional chaining to match the chat popover: a settings file written
    // before providerCliPaths existed would otherwise throw here and take the
    // whole settings tab down with it.
    const configuredPath = this.plugin.settings.providerCliPaths?.[providerId]
      || (providerId === 'copilot' ? this.plugin.settings.copilotCliPath || '' : '');
    const stored = this.plugin.providerConnections?.[providerId]?.state;

    const row = new Setting(containerEl)
      .setName(descriptor.label)
      .setDesc(connectionLabel(stored));
    row.addButton((button) => {
      const label = (state: typeof stored) => (state === 'connected' ? '다시 연결' : '연결');
      button.setButtonText(label(stored));
      // Never disabled. Finding the binary says nothing about being logged in,
      // and disabling here once left copilot and agy users with no route to
      // the login flow at all.
      button.onClick(async () => {
        const { SetupWizardModal } = await import('../../ui/modals/SetupWizardModal');
        // Carry the provider this row is about, so the wizard does not ask
        // again for something the settings tab already showed.
        const modal = new SetupWizardModal(this.app, this.plugin, providerId);
        const close = modal.onClose.bind(modal);
        // Redraw once the wizard is done, or a student who just logged in
        // would be left looking at the 연결 필요 that sent them there.
        modal.onClose = () => { close(); this.display(); };
        modal.open();
      });

      const { signal } = this.probes;
      void checkProviderConnection(providerId, { cliPath: configuredPath || undefined, signal })
        .then((checked) => {
          // A later render owns the rows now; this answer is about dead ones.
          if (signal.aborted) return;
          // An inconclusive check must not erase what a working request proved:
          // on Windows the copilot check can only ever answer 'unknown'.
          const state = resolveCheckedState(stored, checked);
          this.plugin.setProviderConnection(providerId, state);
          row.setDesc(connectionLabel(state));
          button.setButtonText(label(state));
        });
    });
  }

  /**
   * The default model row, for whichever provider is selected.
   *
   * It used to list the bundled Copilot catalog no matter what, and write every
   * choice into settings.model — which native providers never read. Picking a
   * model after choosing Claude changed nothing.
   */
  private renderDefaultModelRow(containerEl: HTMLElement): void {
    const provider = this.plugin.settings.selectedProvider;
    const descriptor = getProviderDescriptor(provider);
    const save = async (value: string) => {
      storeDefaultModel(this.plugin.settings, provider, value);
      await this.plugin.saveSettings();
    };

    if (defaultModelSource(provider) === 'copilot-catalog') {
      new Setting(containerEl)
        .setName('기본 모델')
        .setDesc('채팅과 인라인 편집에 쓸 GitHub Copilot 모델입니다.')
        .addDropdown((dropdown) => {
          for (const model of COPILOT_MODELS) {
            dropdown.addOption(model.value, `${model.label} - ${model.costLabel}`);
          }
          dropdown.setValue(this.plugin.settings.model).onChange(save);
        });
      return;
    }

    const stored = this.plugin.settings.providerModels?.[provider]?.trim() || '';
    const row = new Setting(containerEl)
      .setName('기본 모델')
      .setDesc(`${descriptor.label}에 보낼 모델입니다. 비워 두면 CLI 기본값을 씁니다.`);

    const showList = (options: readonly ProviderModelOption[]) => {
      row.controlEl.empty();
      row.addDropdown((dropdown) => {
        dropdown.addOption('', 'CLI 기본값');
        for (const option of options) dropdown.addOption(option.id, option.label);
        // A stored id the CLI no longer lists still has to be selectable, or
        // the dropdown would quietly show the first option as if it were saved.
        if (stored && !options.some((option) => option.id === stored)) dropdown.addOption(stored, stored);
        dropdown.setValue(stored).onChange(save);
      });
    };

    const bundled = getStaticProviderModels(provider);
    if (bundled.length > 0) { showList(bundled); return; }

    // codex and agy know their own model list and nothing here does, so asking
    // costs a process. It happens on this button, never on opening settings.
    row.addButton((button) => {
      button.setButtonText(stored ? `${stored} · 목록 불러오기` : '모델 목록 불러오기');
      button.onClick(async () => {
        button.setButtonText('불러오는 중…');
        button.setDisabled(true);
        try {
          const options = await this.plugin.agentService.listNativeProviderModels(provider);
          if (options.length === 0) throw new Error('empty list');
          showList(options);
        } catch {
          new Notice(`${descriptor.label}에서 모델 목록을 가져오지 못했습니다. 로그인 여부를 확인해 주세요.`);
          button.setButtonText(stored ? `${stored} · 다시 시도` : '다시 시도');
          button.setDisabled(false);
        }
      });
    });
  }

  /**
   * The skills section, for the provider that is selected.
   *
   * Skipped entirely when that CLI has no skills mechanism. It used to return
   * out of display() instead, which took Chat Behavior and Advanced with it —
   * choosing Codex emptied the rest of the settings screen.
   */
  private renderSkillsSection(containerEl: HTMLElement): void {
    const skillProvider = this.plugin.settings.selectedProvider;

    // Skills & Obsidian Context — collapsible, default collapsed
    const skillsWrapperEl = containerEl.createDiv({ cls: 'ocop-settings-advanced-wrapper' });
    const skillsHeaderEl = skillsWrapperEl.createDiv({ cls: 'ocop-settings-advanced-header' });
    skillsHeaderEl.setAttribute('tabindex', '0');
    skillsHeaderEl.createSpan({ cls: 'ocop-settings-advanced-title', text: 'Skills & Obsidian Context' });
    skillsHeaderEl.createSpan({ cls: 'ocop-settings-advanced-toggle', text: 'Show' });
    const skillsContentEl = skillsWrapperEl.createDiv({ cls: 'ocop-settings-advanced-content' });
    setupCollapsible(skillsWrapperEl, skillsHeaderEl, skillsContentEl, { isExpanded: false }, {
      initiallyExpanded: false,
      onToggle: (isExpanded) => {
        const toggleEl = skillsHeaderEl.querySelector('.ocop-settings-advanced-toggle');
        if (toggleEl) toggleEl.textContent = isExpanded ? 'Hide' : 'Show';
      },
      baseAriaLabel: 'Skills & Obsidian Context settings',
    });

    // Every skill action targets the folder the SELECTED provider reads. The
    // installer used to write .copilot/skills whoever was chosen, so a Claude
    // Code student was told the skills were installed and their CLI never saw
    // them.
    skillsContentEl.createDiv({
      cls: 'setting-item-description',
      text: `${getProviderDescriptor(skillProvider).label}가 위키링크·콜아웃·속성·캔버스를 이해하도록 Obsidian 스킬을 설치합니다.`,
    });
    if (isMachineWideSkillsRoot(skillProvider)) {
      // codex keeps skills in CODEX_HOME, not in the vault, so this install
      // reaches every codex session on the computer. Saying so beats a student
      // discovering it later.
      skillsContentEl.createDiv({
        cls: 'setting-item-description',
        text: 'OpenAI Codex는 스킬을 이 컴퓨터 전체에 저장합니다 (~/.codex/skills). 다른 금고에서도 함께 적용됩니다.',
      });
    }

    const skillsInstalled = isObsidianSkillsInstalled(this.app, skillProvider);
    new Setting(skillsContentEl)
      .setName('Obsidian context skills')
      .setDesc(
        skillsInstalled
          ? `설치됨 - ${getProviderDescriptor(skillProvider).label}가 Obsidian 문법을 이해합니다.`
          : '설치 안 됨 - 대부분의 학생에게 권장합니다.'
      )
      .addButton((button) => {
        if (skillsInstalled) {
          button.setButtonText('Reinstall').onClick(async () => {
            await installObsidianSkills(this.app, skillProvider);
            this.display();
          });
        } else {
          button.setButtonText('Install').setCta().onClick(async () => {
            await installObsidianSkills(this.app, skillProvider);
            this.display();
          });
        }
      })
      .addButton((button) => {
        if (skillsInstalled) {
          button.setButtonText('Remove').onClick(async () => {
            await uninstallObsidianSkills(this.app, skillProvider);
            this.display();
          });
        }
      });

    let skillUrl = '';
    let textInput: HTMLInputElement | null = null;
    new Setting(skillsContentEl)
      .setName('Install custom skill from GitHub')
      .setDesc(`${getProviderDescriptor(skillProvider).label}의 스킬 폴더로 받습니다. 스킬 폴더 주소(.../tree/main/skills/docx)를 넣으면 딸린 스크립트까지 받고, 저장소나 SKILL.md 주소는 그 파일 한 장만 받습니다.`)
      .addText((text) => {
        textInput = text.inputEl;
        text
          .setPlaceholder('https://github.com/username/repo')
          .onChange(async (value) => {
            skillUrl = value;
          });
      })
      .addButton((button) => {
        button.setButtonText('Install').setCta().onClick(async () => {
          if (!skillUrl) {
            new Notice('Please enter a URL');
            return;
          }

          button.setButtonText('Installing...').setDisabled(true);
          try {
            const success = await installSkillFromUrl(this.app, skillUrl, skillProvider);
            if (success) {
              if (textInput) textInput.value = '';
              skillUrl = '';
              this.display();
            }
          } finally {
            button.setButtonText('Install').setDisabled(false);
          }
        });
      });

    // Anthropic publishes these three at github.com/anthropics/skills; the folder
    // URL matters, because each one ships scripts/ next to its SKILL.md.
    // The chips that stood here pointed at three repositories that do not exist.
    const SKILL_SUGGESTIONS = [
      {
        label: 'Word 문서 (docx)',
        url: 'https://github.com/anthropics/skills/tree/main/skills/docx',
        icon: 'file-text',
      },
      {
        label: '슬라이드 (pptx)',
        url: 'https://github.com/anthropics/skills/tree/main/skills/pptx',
        icon: 'presentation',
      },
      {
        label: '엑셀 (xlsx)',
        url: 'https://github.com/anthropics/skills/tree/main/skills/xlsx',
        icon: 'table',
      },
    ];

    skillsContentEl.createDiv({
      cls: 'setting-item-description',
      text: 'Anthropic 공식 스킬 (github.com/anthropics/skills). 눌러서 주소를 채운 뒤 Install을 누릅니다.',
    });

    const suggestionsEl = skillsContentEl.createDiv({ cls: 'ocop-skill-suggestions' });
    for (const suggestion of SKILL_SUGGESTIONS) {
      const chipEl = suggestionsEl.createDiv({ cls: 'ocop-skill-chip' });
      const iconEl = chipEl.createSpan({ cls: 'ocop-skill-chip-icon' });
      setIcon(iconEl, suggestion.icon);
      chipEl.createSpan({ text: suggestion.label });
      chipEl.addEventListener('click', () => {
        if (textInput) {
          textInput.value = suggestion.url;
          textInput.dispatchEvent(new Event('input'));
          skillUrl = suggestion.url;
        }
      });
    }

    const installedSkills = getInstalledSkills(this.app, skillProvider);
    if (installedSkills.length > 0) {
      const installedSkillsDesc = skillsContentEl.createDiv({ cls: 'ocop-skills-installed-desc' });
      installedSkillsDesc.createEl('p', {
        text: `Installed Skills (${installedSkills.length}):`,
        cls: 'setting-item-description',
      });

      const skillsListEl = skillsContentEl.createDiv({ cls: 'ocop-skills-list' });
      for (const skill of installedSkills) {
        const skillItemEl = skillsListEl.createDiv({ cls: 'ocop-skills-item' });
        const skillInfoEl = skillItemEl.createDiv({ cls: 'ocop-skills-item-info' });
        skillInfoEl.createSpan({ cls: 'ocop-skills-item-name', text: skill.name });
        if (skill.isBuiltIn) {
          skillInfoEl.createSpan({ cls: 'ocop-skills-builtin-badge', text: 'Built-in' });
        } else if (skill.isGlobal) {
          skillInfoEl.createSpan({ cls: 'ocop-skills-builtin-badge', text: 'Global' });
        }
        skillInfoEl.createDiv({
          cls: 'ocop-skills-item-desc',
          text: skill.description.length > 100 ? `${skill.description.substring(0, 100)}...` : skill.description,
        });

        if (!skill.isBuiltIn && !skill.isGlobal) {
          const removeBtn = skillItemEl.createEl('button', {
            text: 'Remove',
            cls: 'ocop-skills-remove-btn',
          });
          removeBtn.addEventListener('click', async () => {
            await removeSkill(this.app, skill.name, skillProvider);
            this.display();
          });
        }
      }
    } else {
      skillsContentEl.createDiv({ cls: 'ocop-skills-empty', text: 'No skills installed. Install Obsidian context skills above or add a custom skill from GitHub.' });
    }
  }

  display(): void {
    const { containerEl } = this;
    // Stop the previous render's provider checks before dropping its rows.
    this.probes.abort();
    this.probes = new AbortController();
    containerEl.empty();
    containerEl.addClass('ocop-settings');

    new Setting(containerEl).setName('Quick Start').setHeading();
    containerEl.createDiv({
      cls: 'setting-item-description',
      text: 'Start here: choose your default model and install Obsidian context support.',
    });

    new Setting(containerEl)
      .setName('What should Obsidian AI Tutor call you?')
      .setDesc('Your name for personalized greetings (leave empty for generic greetings)')
      .addText((text) =>
        text
          .setPlaceholder('Enter your name')
          .setValue(this.plugin.settings.userName)
          .onChange(async (value) => {
            this.plugin.settings.userName = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName('AI provider').setDesc('Choose one official CLI; only the selected provider is used for requests.')
      .addDropdown((dropdown) => {
        for (const provider of PROVIDERS) dropdown.addOption(provider.id, provider.label);
        dropdown.setValue(this.plugin.settings.selectedProvider).onChange(async (value) => {
          this.plugin.settings.selectedProvider = value as typeof this.plugin.settings.selectedProvider;
          await this.plugin.saveSettings();
          this.plugin.agentService?.cleanup();
          // The new provider reads a different skills folder, which has never
          // had the bundled skills. Put them there before redrawing.
          await this.plugin.installBundledSkillsOnce();
          this.display();
        });
      });

    // One row per provider: what it is, whether it is connected here, and the
    // one button that fixes it. The chat popover used to ask this question
    // itself by spawning every installed CLI each time it opened — which
    // copilot could not answer at all. It now reads what these rows decided.
    for (const provider of PROVIDERS) {
      this.renderProviderConnectionRow(containerEl, provider.id);
    }

    this.renderDefaultModelRow(containerEl);

    // The path of whichever CLI is selected. This row said "Copilot CLI path"
    // and wrote settings.copilotCliPath whatever provider was chosen — a
    // leftover from when the plugin was Copilot-only, which left the other
    // three with no way to point at a binary outside PATH.
    const pathProvider = this.plugin.settings.selectedProvider;
    const pathDescriptor = getProviderDescriptor(pathProvider);
    const storedCliPath = this.plugin.settings.providerCliPaths?.[pathProvider]
      || (pathProvider === 'copilot' ? this.plugin.settings.copilotCliPath || '' : '');
    const cliPathSetting = new Setting(containerEl)
      .setName(`${pathDescriptor.label} 실행 경로`)
      .setDesc(`자동으로 찾으면 비워 두세요. 못 찾을 때만 "which ${pathDescriptor.command}" 결과를 붙여 넣습니다.`);

    const cliPathValidationEl = containerEl.createDiv({ cls: 'ocop-cli-path-validation' });
    cliPathValidationEl.style.color = 'var(--text-error)';
    cliPathValidationEl.style.fontSize = '0.85em';
    cliPathValidationEl.style.marginTop = '-0.5em';
    cliPathValidationEl.style.marginBottom = '0.5em';
    cliPathValidationEl.style.display = 'none';

    const validateCliPath = (value: string): string | null => {
      const trimmed = value.trim();
      // The bare command name means "find it on PATH", which is not a path to check.
      if (!trimmed || trimmed === pathDescriptor.command) return null;
      const expandedPath = expandHomePath(trimmed);
      if (!fs.existsSync(expandedPath)) return 'Path does not exist';
      return fs.statSync(expandedPath).isFile() ? null : 'Path is a directory, not a file';
    };

    cliPathSetting.addText((text) => {
      const placeholder = process.platform === 'win32'
        ? `C:\\Program Files\\${pathDescriptor.command}.exe`
        : `/usr/local/bin/${pathDescriptor.command}`;
      text
        .setPlaceholder(placeholder)
        .setValue(storedCliPath)
        .onChange(async (value) => {
          const error = validateCliPath(value);
          if (error) {
            cliPathValidationEl.setText(error);
            cliPathValidationEl.style.display = 'block';
            text.inputEl.style.borderColor = 'var(--text-error)';
          } else {
            cliPathValidationEl.style.display = 'none';
            text.inputEl.style.borderColor = '';
          }
          this.plugin.settings.providerCliPaths = {
            ...this.plugin.settings.providerCliPaths,
            [pathProvider]: value.trim(),
          };
          // The request path still reads the legacy field for copilot, so the
          // two must not drift apart.
          if (pathProvider === 'copilot') this.plugin.settings.copilotCliPath = value.trim();
          await this.plugin.saveSettings();
          this.plugin.cliResolver?.reset();
          this.plugin.agentService?.cleanup();
        });
      text.inputEl.addClass('ocop-settings-cli-path-input');
      text.inputEl.style.width = '100%';
      const initialCliError = validateCliPath(storedCliPath);
      if (initialCliError) {
        cliPathValidationEl.setText(initialCliError);
        cliPathValidationEl.style.display = 'block';
        text.inputEl.style.borderColor = 'var(--text-error)';
      }
    });

    this.renderSkillsSection(containerEl);

    // Chat Behavior — collapsible, default collapsed
    const chatWrapperEl = containerEl.createDiv({ cls: 'ocop-settings-advanced-wrapper' });
    const chatHeaderEl = chatWrapperEl.createDiv({ cls: 'ocop-settings-advanced-header' });
    chatHeaderEl.setAttribute('tabindex', '0');
    chatHeaderEl.createSpan({ cls: 'ocop-settings-advanced-title', text: 'Chat Behavior' });
    chatHeaderEl.createSpan({ cls: 'ocop-settings-advanced-toggle', text: 'Show' });
    const chatContentEl = chatWrapperEl.createDiv({ cls: 'ocop-settings-advanced-content' });
    setupCollapsible(chatWrapperEl, chatHeaderEl, chatContentEl, { isExpanded: false }, {
      initiallyExpanded: false,
      onToggle: (isExpanded) => {
        const toggleEl = chatHeaderEl.querySelector('.ocop-settings-advanced-toggle');
        if (toggleEl) toggleEl.textContent = isExpanded ? 'Hide' : 'Show';
      },
      baseAriaLabel: 'Chat Behavior settings',
    });

    chatContentEl.createDiv({
      cls: 'setting-item-description',
      text: 'Control how chat behaves day to day without touching advanced system settings.',
    });

    new Setting(chatContentEl)
      .setName('Excluded tags')
      .setDesc('Notes with these tags will not auto-load as context (one per line, without #)')
      .addTextArea((text) => {
        text
          .setPlaceholder('system\nprivate\ndraft')
          .setValue(this.plugin.settings.excludedTags.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.excludedTags = value
              .split(/\r?\n/)
              .map((entry) => entry.trim().replace(/^#/, ''))
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    new Setting(chatContentEl)
      .setName('Media folder')
      .setDesc('Folder containing attachments/images. Leave empty for vault root.')
      .addText((text) => {
        text
          .setPlaceholder('attachments')
          .setValue(this.plugin.settings.mediaFolder)
          .onChange(async (value) => {
            this.plugin.settings.mediaFolder = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('ocop-settings-media-input');
      });

    new Setting(chatContentEl)
      .setName('Web search')
      .setDesc('Allow the agent to use web search and web fetch tools. Turn off to prevent ground-truth leakage during quizzes.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableWebSearch)
          .onChange(async (value) => {
            this.plugin.settings.enableWebSearch = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(chatContentEl)
      .setName('Auto-generate conversation titles')
      .setDesc('Automatically generate conversation titles after the first exchange.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoTitleGeneration)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoTitleGeneration = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // Copilot only. The chosen id is passed straight to the selected CLI as
    // --model, so offering a Copilot id here to a claude or codex user made
    // every title generation fail on an unrecognised model.
    if (this.plugin.settings.enableAutoTitleGeneration && this.plugin.settings.selectedProvider === 'copilot') {
      new Setting(chatContentEl)
        .setName('Title generation model')
        .setDesc('Model used for auto-generating conversation titles.')
        .addDropdown((dropdown) => {
          dropdown.addOption('', 'Auto');
          for (const model of COPILOT_MODELS) {
            dropdown.addOption(model.value, model.label);
          }
          dropdown
            .setValue(this.plugin.settings.titleGenerationModel || '')
            .onChange(async (value) => {
              this.plugin.settings.titleGenerationModel = value;
              await this.plugin.saveSettings();
            });
        });
    }

    const advancedWrapperEl = containerEl.createDiv({ cls: 'ocop-settings-advanced-wrapper' });
    const advancedHeaderEl = advancedWrapperEl.createDiv({ cls: 'ocop-settings-advanced-header' });
    advancedHeaderEl.setAttribute('tabindex', '0');
    advancedHeaderEl.createSpan({ cls: 'ocop-settings-advanced-title', text: 'Advanced & Power User' });
    advancedHeaderEl.createSpan({ cls: 'ocop-settings-advanced-toggle', text: 'Show' });
    const advancedContentEl = advancedWrapperEl.createDiv({ cls: 'ocop-settings-advanced-content' });
    setupCollapsible(advancedWrapperEl, advancedHeaderEl, advancedContentEl, { isExpanded: false }, {
      initiallyExpanded: false,
      onToggle: (isExpanded) => {
        const toggleEl = advancedHeaderEl.querySelector('.ocop-settings-advanced-toggle');
        if (toggleEl) toggleEl.textContent = isExpanded ? 'Hide' : 'Show';
      },
      baseAriaLabel: 'Advanced settings',
    });

    new Setting(advancedContentEl).setName('Workflows & Shortcuts').setHeading();
    advancedContentEl.createDiv({
      cls: 'setting-item-description',
      text: 'Configure optional workflow presets and keyboard shortcuts once you are comfortable with the basics.',
    });

    const inlineEditCommandId = 'obsidian-ai-tutor:inline-edit';
    const inlineEditHotkey = getHotkeyForCommand(this.app, inlineEditCommandId);
    new Setting(advancedContentEl)
      .setName('Inline edit hotkey')
      .setDesc(inlineEditHotkey ? `Current: ${inlineEditHotkey}` : 'No hotkey set. Click to configure.')
      .addButton((button) => button.setButtonText(inlineEditHotkey ? 'Change' : 'Set hotkey').onClick(() => openHotkeySettings(this.app)));

    const openChatCommandId = 'obsidian-ai-tutor:open-view';
    const openChatHotkey = getHotkeyForCommand(this.app, openChatCommandId);
    new Setting(advancedContentEl)
      .setName('Open chat hotkey')
      .setDesc(openChatHotkey ? `Current: ${openChatHotkey}` : 'No hotkey set. Click to configure.')
      .addButton((button) => button.setButtonText(openChatHotkey ? 'Change' : 'Set hotkey').onClick(() => openHotkeySettings(this.app)));

    new Setting(advancedContentEl).setName('Workflow Presets').setHeading();
    const slashCommandsDesc = advancedContentEl.createDiv({ cls: 'ocop-slash-settings-desc' });
    slashCommandsDesc.createEl('p', {
      text: 'Create custom prompt templates triggered by /command. Use $ARGUMENTS for all arguments, $1/$2 for positional args, @file for file content, and !`bash` for command output.',
      cls: 'setting-item-description',
    });
    const slashCommandsContainer = advancedContentEl.createDiv({ cls: 'ocop-slash-commands-container' });
    new SlashCommandSettings(slashCommandsContainer, this.plugin);

    new Setting(advancedContentEl).setName('Safety & Permissions').setHeading();
    advancedContentEl.createDiv({
      cls: 'setting-item-description',
      text: 'The toggle below is the main safety control for beginners. Detailed allow/block rules are in Advanced.',
    });

    new Setting(advancedContentEl)
      .setName('Enable command blocklist')
      .setDesc('Block potentially dangerous shell commands')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableBlocklist)
          .onChange(async (value) => {
            this.plugin.settings.enableBlocklist = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedContentEl)
      .setName('Enable inline bash in slash commands')
      .setDesc('Allow !`command` syntax in workflow presets to execute shell commands. Disabled by default for security — enable only if you trust your slash command sources.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableInlineBash)
          .onChange(async (value) => {
            this.plugin.settings.enableInlineBash = value;
            await this.plugin.saveSettings();
          })
      );

    const platformKey = getCurrentPlatformKey();
    const isWindows = platformKey === 'windows';
    const platformLabel = isWindows ? 'Windows' : 'Unix';

    new Setting(advancedContentEl)
      .setName(`Blocked commands (${platformLabel})`)
      .setDesc(`Patterns to block on ${platformLabel} (one per line). Supports regex.`)
      .addTextArea((text) => {
        const placeholder = isWindows
          ? 'del /s /q\nrd /s /q\nRemove-Item -Recurse -Force'
          : 'rm -rf\nchmod 777\nmkfs';
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings.blockedCommands[platformKey].join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.blockedCommands[platformKey] = value
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 40;
      });

    if (isWindows) {
      new Setting(advancedContentEl)
        .setName('Blocked commands (Unix/Git Bash)')
        .setDesc('Unix patterns also blocked on Windows because Git Bash can invoke them.')
        .addTextArea((text) => {
          text
            .setPlaceholder('rm -rf\nchmod 777\nmkfs')
            .setValue(this.plugin.settings.blockedCommands.unix.join('\n'))
            .onChange(async (value) => {
              this.plugin.settings.blockedCommands.unix = value
                .split(/\r?\n/)
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 4;
          text.inputEl.cols = 40;
        });
    }

    new Setting(advancedContentEl)
      .setName('Allowed export paths')
      .setDesc('Paths outside the vault where files can be exported (one per line). Supports ~ for home directory.')
      .addTextArea((text) => {
        const placeholder = process.platform === 'win32' ? '~/Desktop\n~/Downloads\n%TEMP%' : '~/Desktop\n~/Downloads\n/tmp';
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings.allowedExportPaths.join('\n'))
          .onChange(async (value) => {
            this.plugin.settings.allowedExportPaths = value
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0);
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 40;
      });

    const approvedDesc = advancedContentEl.createDiv({ cls: 'ocop-approved-desc' });
    approvedDesc.createEl('p', {
      text: 'Actions that have been permanently approved (via Always Allow). These will not require approval in Safe mode.',
      cls: 'setting-item-description',
    });

    if (this.plugin.settings.permissions.length === 0) {
      advancedContentEl.createDiv({
        cls: 'ocop-approved-empty',
        text: 'No approved actions yet. When you click Always Allow in the approval dialog, actions will appear here.',
      });
    } else {
      const listEl = advancedContentEl.createDiv({ cls: 'ocop-approved-list' });
      for (const action of this.plugin.settings.permissions) {
        const itemEl = listEl.createDiv({ cls: 'ocop-approved-item' });
        const infoEl = itemEl.createDiv({ cls: 'ocop-approved-item-info' });
        infoEl.createSpan({ cls: 'ocop-approved-item-tool', text: action.toolName });
        infoEl.createDiv({ cls: 'ocop-approved-item-pattern', text: action.pattern });
        infoEl.createSpan({ cls: 'ocop-approved-item-date', text: new Date(action.approvedAt).toLocaleDateString() });
        const removeBtn = itemEl.createEl('button', { text: 'Remove', cls: 'ocop-approved-remove-btn' });
        removeBtn.addEventListener('click', async () => {
          this.plugin.settings.permissions = this.plugin.settings.permissions.filter((entry: typeof action) => entry !== action);
          await this.plugin.saveSettings();
          this.display();
        });
      }

      new Setting(advancedContentEl)
        .setName('Clear all approved actions')
        .setDesc('Remove all permanently approved actions')
        .addButton((button) =>
          button.setButtonText('Clear all').setWarning().onClick(async () => {
            this.plugin.settings.permissions = [];
            await this.plugin.saveSettings();
            this.display();
          })
        );
    }

    new Setting(advancedContentEl).setName('Authentication & Environment').setHeading();
    advancedContentEl.createDiv({
      cls: 'setting-item-description',
      text: `대부분의 학생은 그대로 두면 됩니다. ${getProviderDescriptor(this.plugin.settings.selectedProvider).label} 로그인이 이미 끝났다면 손댈 필요가 없습니다.`,
    });

    new Setting(advancedContentEl)
      .setName('GitHub token')
      .setDesc('Optional. Uses COPILOT_GITHUB_TOKEN, GH_TOKEN, and GITHUB_TOKEN for the Copilot child process when set.')
      .addText((text) =>
        text
          .setPlaceholder('github_pat_...')
          .setValue(this.plugin.settings.githubToken)
          .onChange(async (value) => {
            this.plugin.settings.githubToken = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(advancedContentEl)
      .setName('Custom variables')
      .setDesc('선택한 provider의 CLI에 넘길 환경 변수입니다 (KEY=VALUE, 한 줄에 하나).')
      .addTextArea((text) => {
        text
          .setPlaceholder('COPILOT_GITHUB_TOKEN=your-token\nGH_TOKEN=your-token')
          .setValue(this.plugin.settings.environmentVariables)
          .onChange(async (value) => {
            await this.plugin.applyEnvironmentVariables(value);
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        text.inputEl.addClass('ocop-settings-env-textarea');
      });

    const envSnippetsContainer = advancedContentEl.createDiv({ cls: 'ocop-env-snippets-container' });
    new EnvSnippetManager(envSnippetsContainer, this.plugin);

    new Setting(advancedContentEl).setName('Advanced & Developer').setHeading();
    advancedContentEl.createDiv({
      cls: 'setting-item-description',
      text: 'Only change these if you know why you need them. They are preserved here for power users and debugging.',
    });

    new Setting(advancedContentEl)
      .setName('Custom system prompt')
      .setDesc('선택한 provider의 기본 프롬프트 뒤에 붙는 추가 지시입니다.')
      .addTextArea((text) => {
        text
          .setPlaceholder('Add custom instructions here...')
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
      });

    new Setting(advancedContentEl)
      .setName('Vim-style navigation mappings')
      .setDesc('One mapping per line. Format: "map <key> <action>" (actions: scrollUp, scrollDown, focusInput).')
      .addTextArea((text) => {
        let pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
        let saveTimeout: number | null = null;

        const commitValue = async (showError: boolean): Promise<void> => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
            saveTimeout = null;
          }

          const result = parseNavMappings(pendingValue);
          if (!result.settings) {
            if (showError) {
              new Notice(`Invalid navigation mappings: ${result.error}`);
              pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
              text.setValue(pendingValue);
            }
            return;
          }

          this.plugin.settings.keyboardNavigation.scrollUpKey = result.settings.scrollUp;
          this.plugin.settings.keyboardNavigation.scrollDownKey = result.settings.scrollDown;
          this.plugin.settings.keyboardNavigation.focusInputKey = result.settings.focusInput;
          await this.plugin.saveSettings();
          pendingValue = buildNavMappingText(this.plugin.settings.keyboardNavigation);
          text.setValue(pendingValue);
        };

        const scheduleSave = (): void => {
          if (saveTimeout !== null) {
            window.clearTimeout(saveTimeout);
          }
          saveTimeout = window.setTimeout(() => {
            void commitValue(false);
          }, 500);
        };

        text
          .setPlaceholder('map w scrollUp\nmap s scrollDown\nmap i focusInput')
          .setValue(pendingValue)
          .onChange((value) => {
            pendingValue = value;
            scheduleSave();
          });

        text.inputEl.rows = 3;
        text.inputEl.addEventListener('blur', async () => {
          await commitValue(true);
        });
      });

  }
}
