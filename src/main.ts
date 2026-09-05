/**
 * ObsidianCode - Obsidian plugin entry point
 *
 * Registers the sidebar chat view, settings tab, and commands.
 * Manages conversation persistence and environment variable configuration.
 */
import type { Editor, MarkdownView } from 'obsidian';
import { addIcon, Notice, Plugin } from 'obsidian';

import { COPILOT_ICON_SVG } from './assets/icon';
import { CopilotBridgeService } from './core/agent/CopilotBridgeService';
import { deleteCachedImages } from './core/images/imageCache';
import { findProviderCliPath, migrateProviderModels, type ProviderId } from './core/providers/providerRegistry';
import { applyRequestOutcome, type ConnectionState, type ProviderConnections } from './core/setup/providerConnection';
import { StorageService } from './core/storage';
import type {
  Conversation,
  ConversationMeta,
  ObsidianCopilotSettings} from './core/types';
import {
  DEFAULT_SETTINGS,
  VIEW_TYPE_OBSIDIAN_COPILOT,
} from './core/types';
import type { ObsidianCopilotView } from './features/chat/ObsidianCopilotView';
import { ObsidianCopilotView as ObsidianCopilotViewImpl } from './features/chat/ObsidianCopilotView';
import { ObsidianCopilotSettingTab } from './features/settings/ObsidianCopilotSettings';
import type { InlineEditContext } from './ui/modals/InlineEditModal';
import { InlineEditModal } from './ui/modals/InlineEditModal';
import { buildCursorContext } from './utils/editor';

/**
 * Main plugin class for ObsidianCode.
 * Handles plugin lifecycle, settings persistence, and conversation management.
 */
export default class ObsidianCopilotPlugin extends Plugin {
  settings: ObsidianCopilotSettings;
  agentService: CopilotBridgeService;
  storage: StorageService;
  private conversations: Conversation[] = [];
  private activeConversationId: string | null = null;
  /** Whether each provider is connected, as last decided by the settings tab
   * or by a finished request. The chat popover reads this instead of asking
   * the CLIs itself. */
  providerConnections: ProviderConnections | undefined;
  private runtimeEnvironmentVariables = '';
  private hasNotifiedEnvChange = false;

  async onload() {
    try {
      await this.loadSettings();
    } catch (error) {
      console.error('[ObsidianCopilot] Failed to load settings during startup:', error);
      this.storage = new StorageService(this);
      this.settings = {
        ...DEFAULT_SETTINGS,
        slashCommands: [],
      };
      this.conversations = [];
      this.activeConversationId = null;
      new Notice('Obsidian AI Tutor loaded with default settings due to a startup error.');
    }

    this.agentService = new CopilotBridgeService(this);
    this.agentService.onOutcome = (providerId, outcome) => {
      const next = applyRequestOutcome(this.providerConnections, providerId, outcome, Date.now());
      // A failure that was not an authentication failure returns the map
      // untouched, and there is nothing to write.
      if (next !== this.providerConnections) this.persistProviderConnections(next);
    };
    this.agentService.onPermissionNotice = (message) => { new Notice(message); };
    void this.agentService.prewarmCapabilities();

    // Show setup wizard on first launch if CLI is missing (fires after layout is ready)
    this.app.workspace.onLayoutReady(() => {
      void this.checkAndShowSetupWizard();
      void this.installBundledSkillsOnce();
    });

    addIcon('obsidian-ai-tutor-icon', COPILOT_ICON_SVG);

    this.registerView(
      VIEW_TYPE_OBSIDIAN_COPILOT,
      (leaf) => new ObsidianCopilotViewImpl(leaf, this)
    );

    this.addRibbonIcon('obsidian-ai-tutor-icon', 'Open Obsidian AI Tutor', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-view',
      name: 'Obsidian AI Tutor: Open chat view',
      callback: () => {
        this.activateView();
      },
    });

    this.addCommand({
      id: 'inline-edit',
      name: 'Obsidian AI Tutor: Inline edit',
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        const selectedText = editor.getSelection();
        const notePath = view.file?.path || 'unknown';

        let editContext: InlineEditContext;
        if (selectedText.trim()) {
          // Selection mode
          editContext = { mode: 'selection', selectedText };
        } else {
          // Cursor mode - build cursor context
          const cursor = editor.getCursor();
          const cursorContext = buildCursorContext(
            (line) => editor.getLine(line),
            editor.lineCount(),
            cursor.line,
            cursor.ch
          );
          editContext = { mode: 'cursor', cursorContext };
        }

        const modal = new InlineEditModal(this.app, this, editContext, notePath);
        const result = await modal.openAndWait();

        if (result.decision === 'accept' && result.editedText !== undefined) {
          new Notice(editContext.mode === 'cursor' ? 'Inserted' : 'Edit applied');
        }
      },
    });

    this.addCommand({
      id: 'attach-current-note',
      name: 'Obsidian AI Tutor: Attach current note to chat',
      checkCallback: (checking: boolean) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return false;

        if (checking) return true;

        // Open chat view if not already open
        this.activateView().then(() => {
          const chatView = this.getView();
          if (chatView?.fileContextManager) {
            const normalizedPath = activeFile.path.replace(/\\/g, '/');
            chatView.fileContextManager.attachFileFromCommand(normalizedPath);
            new Notice(`Attached: ${activeFile.name}`);
          }
        }).catch((error: unknown) => {
          console.error('[ObsidianCopilot] Failed to activate view for file attach:', error);
        });
        return true;
      },
    });

    this.addSettingTab(new ObsidianCopilotSettingTab(this.app, this));
  }

  onunload() {
    this.agentService.cleanup();
  }

  /** Opens the ObsidianCode sidebar view, creating it if necessary. */
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_OBSIDIAN_COPILOT)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        await rightLeaf.setViewState({
          type: VIEW_TYPE_OBSIDIAN_COPILOT,
          active: true,
        });
        leaf = rightLeaf;
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Show the first-run setup wizard if the Copilot CLI is not found.
   * Only fires once per Obsidian session to avoid pestering users.
   */
  private async checkAndShowSetupWizard(): Promise<void> {
    try {
      const { hasShownThisSession } = await import('./core/setup/AutoSetupService');
      if (hasShownThisSession()) return;
      if (this.settings.providerCliPaths[this.settings.selectedProvider]) return; // Manual path configured

      const { checkProviderSetupStatus } = await import('./core/setup/AutoSetupService');
      const { cliFound } = checkProviderSetupStatus(this.settings.selectedProvider);
      if (cliFound) return; // Already found via auto-detect

      const { SetupWizardModal } = await import('./ui/modals/SetupWizardModal');
      new SetupWizardModal(this.app, this).open();
    } catch (err) {
      console.warn('[ObsidianCopilot] Setup wizard failed to open:', err);
    }
  }

  /**
   * Put the bundled Obsidian skills in the vault, once.
   *
   * They teach the CLI wikilinks, callouts, properties and canvas files, and
   * they used to wait behind an Install button in a collapsed settings section
   * — so the students who needed them most never got them. Installed on first
   * launch only: the flag means a student who removes them keeps them removed.
   */
  async installBundledSkillsOnce(): Promise<void> {
    try {
      // Per provider: each CLI reads a different folder, so switching provider
      // means a folder that has never had these skills.
      const provider = this.settings.selectedProvider;
      const state = await this.storage.loadState();
      const { installObsidianSkills, isObsidianSkillsInstalled, shouldInstallBundledSkills } =
        await import('./features/skills/ObsidianSkillsInstaller');
      if (!shouldInstallBundledSkills(state, provider, isObsidianSkillsInstalled(this.app, provider))) return;
      // Only record the attempt when it worked, so a vault path that was not
      // ready yet gets another chance next launch instead of being written off.
      if (await installObsidianSkills(this.app, provider)) {
        await this.storage.updateState({
          skillsAutoInstalled: { ...state.skillsAutoInstalled, [provider]: true },
        });
      }
    } catch (error) {
      console.warn('[ObsidianCopilot] Could not install the bundled skills:', error);
    }
  }

  /** Loads settings and conversations from persistent storage. */
  async loadSettings() {
    // Initialize storage service (handles migration if needed)
    this.storage = new StorageService(this);
    const { settings, state } = await this.storage.initialize();

    // Load slash commands from files
    const slashCommands = await this.storage.commands.loadAll();

    // Merge settings with defaults, state fields, and slashCommands
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      slashCommands,
    };

    // Migrate legacy permission mode values (yolo→agent, normal→ask)
    if ((this.settings.permissionMode as string) === 'yolo') this.settings.permissionMode = 'agent';
    if ((this.settings.permissionMode as string) === 'normal') this.settings.permissionMode = 'ask';
    if ((this.settings.lastNonPlanPermissionMode as string) === 'yolo') this.settings.lastNonPlanPermissionMode = 'agent';
    if ((this.settings.lastNonPlanPermissionMode as string) === 'normal') this.settings.lastNonPlanPermissionMode = 'ask';

    // Plan is no longer one of the toggle's states. Normalising it here rather than
    // at each reader keeps `permissionMode` to the two values the UI can show, so a
    // stored 'plan' cannot make the toolbar say one thing and the plan lock another.
    if (this.settings.permissionMode === 'plan') this.settings.permissionMode = 'ask';

    // Migrate deprecated model names
    if ((this.settings.model as string) === 'gpt-4o') this.settings.model = 'gpt-4.1';

    // Clear provider model ids a previous release offered that the CLI no longer lists.
    migrateProviderModels(this.settings.providerModels);

    // Load all conversations from session files
    this.conversations = await this.storage.sessions.loadAllConversations();
    this.activeConversationId = state.activeConversationId;
    this.providerConnections = state.providerConnections;

    // Validate active conversation exists
    if (this.activeConversationId &&
      !this.conversations.find(c => c.id === this.activeConversationId)) {
      this.activeConversationId = null;
    }

    const backfilledConversations = this.backfillConversationResponseTimestamps();
    this.runtimeEnvironmentVariables = this.settings.environmentVariables || '';

    // Persist backfilled conversations to their session files
    for (const conv of backfilledConversations) {
      try {
        await this.storage.sessions.saveConversation(conv);
      } catch (error) {
        console.error(`[ObsidianCopilot] Failed to persist backfilled conversation ${conv.id}:`, error);
      }
    }
  }

  private backfillConversationResponseTimestamps(): Conversation[] {
    const updated: Conversation[] = [];
    for (const conv of this.conversations) {
      if (conv.lastResponseAt != null) continue;
      if (!conv.messages || conv.messages.length === 0) continue;

      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (msg.role === 'assistant') {
          conv.lastResponseAt = msg.timestamp;
          updated.push(conv);
          break;
        }
      }
    }
    return updated;
  }

  /** Persists settings to storage. */
  async saveSettings() {
    const { slashCommands: _, ...settingsToSave } = this.settings;
    await this.storage.settings.save(settingsToSave);

    await this.storage.saveState({
      activeConversationId: this.activeConversationId,
      // saveState writes the whole state object, so anything omitted here is
      // erased. Picking a provider in the chat popover calls saveSettings, and
      // without this line that click wiped every stored connection.
      providerConnections: this.providerConnections,
    });
  }

  /** Store what a check or a request just decided about one provider. */
  setProviderConnection(providerId: ProviderId, state: ConnectionState): void {
    this.persistProviderConnections({
      ...this.providerConnections,
      [providerId]: { state, at: Date.now() },
    });
  }

  private persistProviderConnections(next: ProviderConnections): void {
    this.providerConnections = next;
    // Nothing above awaits this, so a failed disk write must be swallowed here
    // rather than surfacing as an unhandled rejection in the settings tab.
    void this.storage?.updateState({ providerConnections: next })
      .catch((error: unknown) => console.warn('[ObsidianCopilot] Failed to store provider connection:', error));
  }

  getActiveEnvironmentVariables(): string {
    return this.runtimeEnvironmentVariables;
  }

  async applyEnvironmentVariables(envText: string): Promise<void> {
    this.settings.environmentVariables = envText;
    await this.saveSettings();

    if (envText !== this.runtimeEnvironmentVariables) {
      if (!this.hasNotifiedEnvChange) {
        new Notice('Environment variables changed. Restart the plugin for changes to take effect.');
        this.hasNotifiedEnvChange = true;
      }
    } else {
      this.hasNotifiedEnvChange = false;
    }
  }

  getResolvedCopilotCliPath(): string | null {
    return this.settings.copilotCliPath || findProviderCliPath(this.settings.selectedProvider, this.settings.providerCliPaths[this.settings.selectedProvider] || '') || 'copilot';
  }

  get cliResolver(): { resolve: () => string | null; reset: () => void } {
    return { 
      resolve: () => this.getResolvedCopilotCliPath(),
      reset: () => {}
    };
  }

  /** Removes cached images associated with a conversation if not used elsewhere. */
  private cleanupConversationImages(conversation: Conversation): void {
    const cachePaths = new Set<string>();

    for (const message of conversation.messages || []) {
      if (!message.images) continue;
      for (const img of message.images) {
        if (img.cachePath) {
          cachePaths.add(img.cachePath);
        }
      }
    }

    if (cachePaths.size === 0) return;

    const inUseElsewhere = new Set<string>();
    for (const conv of this.conversations) {
      if (conv.id === conversation.id) continue;
      for (const msg of conv.messages || []) {
        if (!msg.images) continue;
        for (const img of msg.images) {
          if (img.cachePath && cachePaths.has(img.cachePath)) {
            inUseElsewhere.add(img.cachePath);
          }
        }
      }
    }

    const deletable = Array.from(cachePaths).filter(p => !inUseElsewhere.has(p));
    if (deletable.length > 0) {
      deleteCachedImages(this.app, deletable);
    }
  }

  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateDefaultTitle(): string {
    const now = new Date();
    return now.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private getConversationPreview(conv: Conversation): string {
    const firstUserMsg = conv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return 'New conversation';
    return firstUserMsg.content.substring(0, 50) + (firstUserMsg.content.length > 50 ? '...' : '');
  }

  /** Creates a new conversation and sets it as active. */
  async createConversation(): Promise<Conversation> {
    const conversation: Conversation = {
      id: this.generateConversationId(),
      title: this.generateDefaultTitle(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: null,
      messages: [],
    };

    this.conversations.unshift(conversation);
    this.activeConversationId = conversation.id;
    this.agentService.resetSession();

    // Save new conversation to session file
    await this.storage.sessions.saveConversation(conversation);
    await this.storage.updateState({ activeConversationId: this.activeConversationId });

    return conversation;
  }

  /** Switches to an existing conversation by ID. */
  async switchConversation(id: string): Promise<Conversation | null> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return null;

    this.activeConversationId = id;
    this.agentService.setSessionId(conversation.sessionId);

    await this.storage.updateState({ activeConversationId: this.activeConversationId });
    return conversation;
  }

  /** Deletes a conversation and switches to another if necessary. */
  async deleteConversation(id: string): Promise<void> {
    const index = this.conversations.findIndex(c => c.id === id);
    if (index === -1) return;

    const conversation = this.conversations[index];
    this.cleanupConversationImages(conversation);
    this.conversations.splice(index, 1);

    // Delete the session file
    await this.storage.sessions.deleteConversation(id);

    if (this.activeConversationId === id) {
      if (this.conversations.length > 0) {
        await this.switchConversation(this.conversations[0].id);
      } else {
        await this.createConversation();
      }
    }
  }

  /** Renames a conversation. */
  async renameConversation(id: string, title: string): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    conversation.title = title.trim() || this.generateDefaultTitle();
    conversation.updatedAt = Date.now();
    await this.storage.sessions.saveConversation(conversation);
  }

  /** Updates conversation properties (messages, sessionId, etc.). */
  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    Object.assign(conversation, updates, { updatedAt: Date.now() });
    await this.storage.sessions.saveConversation(conversation);
  }

  /** Returns the current active conversation. */
  getActiveConversation(): Conversation | null {
    return this.conversations.find(c => c.id === this.activeConversationId) || null;
  }

  /** Gets a conversation by ID from the in-memory cache. */
  getConversationById(id: string): Conversation | null {
    return this.conversations.find(c => c.id === id) || null;
  }

  /** Finds an existing empty conversation (no messages). */
  findEmptyConversation(): Conversation | null {
    return this.conversations.find(c => c.messages.length === 0) || null;
  }

  /** Returns conversation metadata list for the history dropdown. */
  getConversationList(): ConversationMeta[] {
    return this.conversations.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastResponseAt: c.lastResponseAt,
      messageCount: c.messages.length,
      preview: this.getConversationPreview(c),
      titleGenerationStatus: c.titleGenerationStatus,
    }));
  }

  /** Returns the active ObsidianCode view from workspace, if open. */
  getView(): ObsidianCopilotView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_OBSIDIAN_COPILOT);
    if (leaves.length > 0) {
      return leaves[0].view as ObsidianCopilotView;
    }
    return null;
  }
}
