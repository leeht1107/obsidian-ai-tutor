/**
 * ObsidianCode - Obsidian plugin entry point
 *
 * Registers the sidebar chat view, settings tab, and commands.
 * Manages conversation persistence and environment variable configuration.
 */
import type { Editor, MarkdownView } from 'obsidian';
import { addIcon, Notice, Plugin, requestUrl } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { COPILOT_ICON_SVG } from './assets/icon';
import { CopilotBridgeService } from './core/agent/CopilotBridgeService';
import { deleteCachedImages } from './core/images/imageCache';
import {
  type CompletedLearningSnapshot,
  DEFAULT_LEARNING_RECORDS_FOLDER,
  LearningRecordSaveService,
  normalizeVaultPath,
} from './core/learning/records';
import {
  migrateProviderModels,
  type NativePermissionMode,
  type ProviderId,
  resolveEffectivePermissionMode,
  resolveProviderCliPath,
} from './core/providers/providerRegistry';
import { applyRequestOutcome, type ConnectionState, type ProviderConnections } from './core/setup/providerConnection';
import { StorageService } from './core/storage';
import { reportBlockingFailure } from './core/storage/FailureReport';
import { ObsidianRecordFs } from './core/storage/LearningRecordFs';
import type {
  ChatMessage,
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
import type { ArchiveSource } from './features/skills/docSkillsArchive';
import type { InlineEditContext } from './ui/modals/InlineEditModal';
import { cancelActiveInlineEdit, InlineEditModal } from './ui/modals/InlineEditModal';
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
  /** True when this launch moved credentials out of the vault settings file.
   * Only then does the student get the one-time explanation. */
  private secretsJustMoved = false;
  /**
   * Count of in-flight actions that can still write: slash-command inline bash
   * expansions (chat input or inline edit) and a streaming provider request. A counter,
   * not a boolean — two of these can overlap (e.g. a chat reply streaming while an
   * inline-edit bash expansion runs), and whichever finishes first must not unlock the
   * toggle while the other is still going. Read only through `isBashExpansionInFlight()`;
   * mutated only through `setBashExpansionActive()`, whose name predates provider
   * streaming joining the same counter but is kept so none of its call sites changed.
   */
  private writeAuthorityCount = 0;
  /**
   * The effective permission mode ('ask' | 'agent') resolved at the moment
   * `writeAuthorityCount` went 0 -> 1, kept until it drains back to 0. Settings and the
   * selected provider can both change while a request is in flight — provider switching
   * in particular stays enabled during streaming — so re-resolving the mode from CURRENT
   * settings while something is still running would describe a different, later decision
   * than the one that actually authorized the in-flight work. The toggle must show what
   * the running work was authorized under, not what a fresh resolution would say now.
   */
  private capturedPermissionMode: NativePermissionMode | null = null;
  /** Invalidates consent dialogs opened before a lifecycle authority reset. */
  private permissionAuthorityEpoch = 0;

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
      // `this.storage` was just built above, so the log is reachable even though
      // everything the student configured has been replaced by defaults. This is
      // the failure most likely to be described later as "it forgot everything",
      // and it had no record at all.
      reportBlockingFailure(this, {
        notice: 'Obsidian AI Tutor loaded with default settings due to a startup error.',
        stage: 'internal',
        detail: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
      });
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
      void this.ensureBundledSkills();
      void this.finishSecretMove();
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
    // Inline Edit owns an isolated bridge, so the plugin lifecycle must explicitly
    // terminate it before cleaning up the main chat bridge.
    cancelActiveInlineEdit();
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
      const { checkProviderSetupStatus } = await import('./core/setup/AutoSetupService');
      const { cliFound } = checkProviderSetupStatus(this.settings.selectedProvider, this.settings);
      if (cliFound) return; // Already found via auto-detect

      const { SetupWizardModal } = await import('./ui/modals/SetupWizardModal');
      new SetupWizardModal(this.app, this).open();
    } catch (err) {
      console.warn('[ObsidianCopilot] Setup wizard failed to open:', err);
    }
  }

  /** One run per skills root at a time; claude and agy use different roots, so a fast switch runs both. */
  private bundledSkillRuns = new Map<string, Promise<void>>();
  private docArchiveSource: Promise<ArchiveSource> | null = null;
  private libreOfficeNoticeChecking = false;
  /** Per skills root: what ensure left alone and why, for the Settings line. */
  bundledSkillProblems = new Map<string, string[]>();
  private lastEnsuredProvider: string | null = null;
  /** Plan §3: at most one download-failure notice a day, counted across restarts. */
  private docDownloadNoticeDue(now = Date.now()): boolean {
    const KEY = 'ai-tutor-doc-download-notice-at';
    const last = Number(this.app.loadLocalStorage(KEY) ?? 0);
    if (Number.isFinite(last) && now - last < 24 * 60 * 60 * 1000) return false;
    this.app.saveLocalStorage(KEY, String(now));
    return true;
  }

  /**
   * Put the bundled skills (obsidian-markdown, json-canvas, pdf, xlsx, docx,
   * pptx) into the selected provider's skills folder.
   *
   * Runs on every launch and every provider switch, not once: a skill added in
   * a later release must reach students who installed earlier. Per-skill
   * records keep a removed skill removed (see BundledSkills.ts).
   */
  async ensureBundledSkills(provider = this.settings.selectedProvider): Promise<void> {
    this.lastEnsuredProvider = provider;
    const { autoSkillsRoot } = await import('./features/skills/BundledSkills');
    const root = autoSkillsRoot(provider);
    const running = this.bundledSkillRuns.get(root);
    if (running) return running;
    const run = this.ensureBundledSkillsRoot(root, provider).finally(() => this.bundledSkillRuns.delete(root));
    this.bundledSkillRuns.set(root, run);
    return run;
  }

  private async ensureBundledSkillsRoot(root: string, provider: ProviderId): Promise<void> {
    try {
      const { getVaultPath } = await import('./utils/path');
      const vaultPath = getVaultPath(this.app);
      if (!vaultPath) return; // vault path not ready; the next launch or switch tries again
      const { ensureRoot } = await import('./features/skills/BundledSkills');
      const { OBSIDIAN_MARKDOWN_SKILL, JSON_CANVAS_SKILL } = await import('./features/skills/ObsidianSkillsInstaller');
      const source = await this.getDocArchiveSource(vaultPath);
      const state = await this.storage.loadState();
      const result = await ensureRoot({
        vaultPath,
        root,
        records: state.bundledSkills?.[root] ?? {},
        markdownBodies: { 'obsidian-markdown': OBSIDIAN_MARKDOWN_SKILL, 'json-canvas': JSON_CANVAS_SKILL },
        evidence: { legacyUser: state.bundledSkillsLegacy === true, provider, skillsAutoInstalled: state.skillsAutoInstalled },
        getArchive: () => source.get(),
      });
      await this.storage.mergeBundledSkills(root, result.records);
      if (result.installed.some((name) => ['pdf', 'xlsx', 'docx', 'pptx'].includes(name))) {
        new Notice('✅ 문서 스킬(PDF·엑셀·워드·PPT)을 설치했습니다.');
        this.onDocSkillsInstalled?.();
      }
      if (result.pending.length > 0 && source.failures() > 0 && this.docDownloadNoticeDue()) {
        new Notice('문서 스킬을 아직 내려받지 못했습니다. 인터넷에 연결되면 다음 실행 때 다시 시도합니다.');
      }
      this.bundledSkillProblems.set(root, result.errors);
      if (result.errors.length > 0) console.warn('[ObsidianCopilot] Bundled skills left as they were:', result.errors);
    } catch (error) {
      // Not the console alone: nobody reads it, and this hid a broken install
      // through every unit test (2026-11-13). Settings shows the line.
      this.bundledSkillProblems.set(root, [`설치 실패: ${error instanceof Error ? error.message : String(error)}`]);
      console.warn('[ObsidianCopilot] Could not install the bundled skills:', error);
    }
  }

  /** Called after doc skills were installed in some root: tell the student once if LibreOffice is missing. */
  onDocSkillsInstalled?: () => void = () => { void this.maybeShowLibreOfficeNotice(); };

  /** Where LibreOffice's soffice lives on this computer, or null. Looks at files only. */
  async findLibreOffice(): Promise<string | null> {
    const { findLibreOffice } = await import('./core/setup/libreOffice');
    return findLibreOffice({ platform: process.platform, env: process.env, home: os.homedir() });
  }

  /** The once-only LibreOffice popup (also opened from Settings with force). */
  async maybeShowLibreOfficeNotice(force = false): Promise<void> {
    const KEY = 'ai-tutor-libreoffice-notice-shown';
    const platform = process.platform;
    if (platform !== 'darwin' && platform !== 'win32') return;
    if (!force && (this.app.loadLocalStorage(KEY) || this.libreOfficeNoticeChecking)) return;
    // Two roots can finish installing together; the check below awaits, so
    // claim the popup first.
    this.libreOfficeNoticeChecking = true;
    try {
      if (!force && (await this.findLibreOffice())) return;
    } finally {
      this.libreOfficeNoticeChecking = false;
    }
    this.app.saveLocalStorage(KEY, '1');
    const { LibreOfficeNoticeModal } = await import('./ui/modals/LibreOfficeNoticeModal');
    new LibreOfficeNoticeModal(this.app, platform, {
      prefillChat: async (prompt) => {
        await this.activateView();
        this.getView()?.prefillInput(prompt);
      },
    }).open();
  }

  /** One source for every root, so a fast provider switch still downloads once. */
  private getDocArchiveSource(vaultPath: string): Promise<ArchiveSource> {
    this.docArchiveSource ??= this.createDocArchiveSource(vaultPath).catch((error: unknown) => {
      this.docArchiveSource = null; // let the next ensure try again
      throw error;
    });
    return this.docArchiveSource;
  }

  private async createDocArchiveSource(vaultPath: string): Promise<ArchiveSource> {
    const { createArchiveSource } = await import('./features/skills/docSkillsArchive');
    const pluginDir = this.manifest?.dir ?? '.obsidian/plugins/obsidian-ai-tutor';
    const RETRY_KEY = 'ai-tutor-doc-download-retry';
    return createArchiveSource({
      cacheDir: path.join(vaultPath, pluginDir),
      // The wait after failures survives a restart, so a class reopening
      // Obsidian does not all retry at once.
      retry: {
        load: () => {
          try {
            const raw: unknown = JSON.parse(String(this.app.loadLocalStorage(RETRY_KEY) ?? 'null'));
            const v = raw as { failures?: unknown; nextTryAt?: unknown } | null;
            return v && typeof v.failures === 'number' && typeof v.nextTryAt === 'number' ? { failures: v.failures, nextTryAt: v.nextTryAt } : null;
          } catch {
            return null;
          }
        },
        save: (state) => this.app.saveLocalStorage(RETRY_KEY, JSON.stringify(state)),
      },
      fetchBytes: async (url) => {
        const response = await requestUrl({ url, throw: false });
        return response.status === 200 ? Buffer.from(response.arrayBuffer) : null;
      },
    });
  }

  async loadSettings() {
    // Read before anything writes: data.json with no bundledSkills means this
    // student ran an older release, whose skill records may have been erased.
    let legacyData = false;
    try {
      const raw: unknown = await this.loadData();
      legacyData = !!raw && typeof raw === 'object' && !('bundledSkills' in raw) && !('bundledSkillsLegacy' in raw);
    } catch {
      legacyData = false;
    }
    // Initialize storage service (handles migration if needed)
    this.storage = new StorageService(this);
    const { settings, state } = await this.storage.initialize();
    // Kept in state so the evidence outlives the first launch: a shared skills
    // root first visited weeks later must still get the 0.1.51 rule.
    if (legacyData) await this.storage.updateState({ bundledSkillsLegacy: true });

    // Load slash commands from files
    const slashCommands = await this.storage.commands.loadAll();

    // Merge settings with defaults, state fields, and slashCommands
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      slashCommands,
    };

    // A settings file from before learning records has no folder; a hand-edited one may hold an
    // unusable value. Either way records use the default instead of failing every later save.
    const storedFolder: unknown = this.settings.learningRecordsFolder;
    this.settings.learningRecordsFolder = typeof storedFolder === 'string' && normalizeVaultPath(storedFolder)
      ? normalizeVaultPath(storedFolder) as string
      : DEFAULT_LEARNING_RECORDS_FOLDER;

    // Credentials and trust state must not stay in the shareable vault settings
    // file. Device-local storage is authoritative; from here on these fields
    // are read from and written to that store only.
    const {
      readSecrets,
      readTrust,
    } = await import('./core/storage/SecretStorage');
    const secrets = readSecrets(this.app);
    this.settings.githubToken = secrets.githubToken;
    this.settings.environmentVariables = secrets.environmentVariables;

    const trust = readTrust(this.app);
    this.settings.permissionMode = 'ask';
    this.settings.blanketWriteAcknowledged = [];
    this.settings.allowUnsafeAgyAgent = trust.allowUnsafeAgyAgent;
    this.settings.permissions = trust.permissions;
    this.settings.enableInlineBash = trust.enableInlineBash;
    this.settings.enableBlocklist = trust.enableBlocklist;
    this.settings.blockedCommands = trust.blockedCommands;
    this.settings.providerCliPaths = trust.providerCliPaths;
    this.settings.copilotCliPath = trust.copilotCliPath;
    this.settings.allowedExportPaths = trust.allowedExportPaths;
    this.settings.envSnippets = trust.envSnippets;

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

  /**
   * Rewrite the vault settings file without the credentials, then tell the
   * student once. The rewrite has to happen — `adoptSecretsFromSettings` only
   * blanked the in-memory copy, and the token is still on disk until we save.
   */
  private async finishSecretMove(): Promise<void> {
    if (!this.secretsJustMoved) return;
    this.secretsJustMoved = false;
    try {
      await this.saveSettings();
      const { showSecretMoveNotice } = await import('./ui/modals/SecretMoveNoticeModal');
      showSecretMoveNotice(this.app);
    } catch (error) {
      console.error('[ObsidianCopilot] Failed to complete the secret move:', error);
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
    // Credentials and trust state go to device-local storage, never to the vault file.
    // SettingsStorage.save strips them again as a backstop.
    const { writeSecretsOrNotify, writeTrustOrNotify } = await import('./core/storage/SecretStorage');
    writeSecretsOrNotify(this.app, {
      githubToken: this.settings.githubToken ?? '',
      environmentVariables: this.settings.environmentVariables ?? '',
    }, this);
    writeTrustOrNotify(this.app, {
      // Runtime Agent authority never crosses a reload. Only the separate Agy
      // expert preference persists; every actual transition is confirmed again.
      permissionMode: 'ask',
      blanketWriteAcknowledged: [],
      allowUnsafeAgyAgent: this.settings.allowUnsafeAgyAgent ?? false,
      permissions: this.settings.permissions ?? [],
      enableInlineBash: this.settings.enableInlineBash,
      enableBlocklist: this.settings.enableBlocklist,
      blockedCommands: this.settings.blockedCommands,
      providerCliPaths: this.settings.providerCliPaths ?? {},
      copilotCliPath: this.settings.copilotCliPath ?? '',
      allowedExportPaths: this.settings.allowedExportPaths ?? [],
      envSnippets: this.settings.envSnippets ?? [],
    }, this);
    await this.storage.settings.save(settingsToSave);

    // updateState, not saveState: saveState writes the whole object, so any
    // field left out here was erased. A provider switch in the chat popover
    // calls this, and in 0.1.51 it wiped skillsAutoInstalled — a removed
    // bundled skill then came back on the next launch.
    await this.storage.updateState({
      activeConversationId: this.activeConversationId,
      providerConnections: this.providerConnections,
    });
    // Every provider switch (chat popover, settings, setup wizard) saves
    // settings, so this is the one place that sees all of them.
    if (this.lastEnsuredProvider !== null && this.lastEnsuredProvider !== this.settings.selectedProvider) {
      void this.ensureBundledSkills();
      if (this.settings.selectedProvider === 'agy') void this.maybeShowAgyWebSearchNotice();
    }
  }

  /** Once per computer, on the first switch to agy: its web search cannot be turned off per request. */
  private async maybeShowAgyWebSearchNotice(): Promise<void> {
    const KEY = 'ai-tutor-agy-websearch-notice-shown';
    if (this.app.loadLocalStorage(KEY)) return;
    this.app.saveLocalStorage(KEY, '1');
    const { AgyWebSearchNoticeModal } = await import('./ui/modals/AgyWebSearchNoticeModal');
    new AgyWebSearchNoticeModal(this.app).open();
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
    return resolveProviderCliPath(this.settings, this.settings.selectedProvider) || 'copilot';
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
    await this.persistConversation(conversation);
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

    // Delete the session file after every write already queued for it has settled
    await this.enqueueConversationTask(id, () => this.storage.sessions.deleteConversation(id));

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
    await this.persistConversation(conversation);
  }

  /** Updates conversation properties (messages, sessionId, etc.). */
  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.conversations.find(c => c.id === id);
    if (!conversation) return;

    // An acknowledged snapshot is owned by writeSnapshot: a caller's older copy of a message
    // (taken before the ack) must not take it away again.
    const snapshots = new Map(conversation.messages.map((message) => [message.id, message.learningSnapshot]));
    const messages = updates.messages?.map((message) => {
      const known = snapshots.get(message.id);
      return known ? { ...message, learningSnapshot: known } : message;
    });
    Object.assign(conversation, updates, messages ? { messages } : {}, { updatedAt: Date.now() });
    await this.persistConversation(conversation);
  }

  /** The tail of each conversation's write stream; its writes run one at a time, in call order. */
  private conversationWrites = new Map<string, Promise<void>>();

  private enqueueConversationTask<T>(id: string, task: () => Promise<T>): Promise<T> {
    const result = (this.conversationWrites.get(id) ?? Promise.resolve()).then(task);
    const tail = result.then(() => undefined, () => undefined);
    this.conversationWrites.set(id, tail);
    void tail.then(() => {
      if (this.conversationWrites.get(id) === tail) this.conversationWrites.delete(id);
    });
    return result;
  }

  /** Writes the conversation as it is when its turn comes; a conversation deleted meanwhile is not brought back. */
  private persistConversation(conversation: Conversation): Promise<void> {
    return this.enqueueConversationTask(conversation.id, async () => {
      if (!this.conversations.includes(conversation)) return;
      await this.storage.sessions.saveConversation(conversation);
    });
  }

  /** Returns the current active conversation. */
  getActiveConversation(): Conversation | null {
    return this.conversations.find(c => c.id === this.activeConversationId) || null;
  }

  /** Listeners told after a learning snapshot was acknowledged by storage (views sync their state). */
  private snapshotListeners = new Set<(conversationId: string, messageId: string, snapshot: CompletedLearningSnapshot) => void>();

  onLearningSnapshotCommitted(
    listener: (conversationId: string, messageId: string, snapshot: CompletedLearningSnapshot) => void,
  ): () => void {
    this.snapshotListeners.add(listener);
    return () => { this.snapshotListeners.delete(listener); };
  }

  /** The persisted snapshot of one completed message, or null (legacy and unknown ids included). */
  getLearningSnapshot(conversationId: string, messageId: string): CompletedLearningSnapshot | null {
    const conversation = this.getConversationById(conversationId);
    return conversation?.messages.find((message) => message.id === messageId)?.learningSnapshot ?? null;
  }

  /**
   * Writes one message's snapshot and resolves true only after the session file write was
   * acknowledged. The cache changes after the write, so a failed write leaves nothing that looks
   * saved. `updateConversation` is not used: it ignores unknown ids and caches before writing.
   * `attach` is the first write of a snapshot; `update` replaces an existing one.
   */
  private async writeSnapshot(
    conversationId: string,
    messageId: string,
    next: (current: CompletedLearningSnapshot | undefined) => CompletedLearningSnapshot | null,
  ): Promise<boolean> {
    const conversation = this.conversations.find((c) => c.id === conversationId);
    if (!conversation || !conversation.messages.some((message) => message.id === messageId)) return false;
    return this.enqueueConversationTask(conversationId, async () => {
      // Everything below starts from the conversation as it is now, after earlier writes finished.
      if (!this.conversations.includes(conversation)) return false;
      const current = conversation.messages.find((message) => message.id === messageId);
      if (!current) return false;
      const snapshot = next(current.learningSnapshot);
      if (!snapshot) return false;
      const withSnapshot = (messages: ChatMessage[]) => messages.map((message) => (
        message.id === messageId ? { ...message, learningSnapshot: snapshot } : message
      ));
      const candidate: Conversation = { ...conversation, messages: withSnapshot(conversation.messages), updatedAt: Date.now() };
      try {
        await this.storage.sessions.saveConversation(candidate);
      } catch (error) {
        console.error('[ObsidianCopilot] Failed to persist learning snapshot:', error);
        return false;
      }
      // A message added while the write was in flight stays: only the snapshot is applied to the cache.
      if (!this.conversations.includes(conversation) || !conversation.messages.some((message) => message.id === messageId)) return false;
      Object.assign(conversation, { messages: withSnapshot(conversation.messages), updatedAt: candidate.updatedAt });
      for (const listener of this.snapshotListeners) listener(conversationId, messageId, snapshot);
      return true;
    });
  }

  /** First persistence of a completed message's snapshot; false means nothing restart-safe exists. */
  attachLearningSnapshot(conversationId: string, messageId: string, snapshot: CompletedLearningSnapshot): Promise<boolean> {
    return this.writeSnapshot(conversationId, messageId, (current) => current ?? snapshot);
  }

  commitLearningSnapshot(
    conversationId: string,
    messageId: string,
    update: (snapshot: CompletedLearningSnapshot) => CompletedLearningSnapshot,
  ): Promise<boolean> {
    return this.writeSnapshot(conversationId, messageId, (current) => (current ? update(current) : null));
  }

  private learningSaveService: LearningRecordSaveService | null = null;

  /** One service per plugin so duplicate clicks from any view share one attempt. */
  getLearningRecordSaveService(): LearningRecordSaveService {
    this.learningSaveService ??= new LearningRecordSaveService({
      fs: new ObsidianRecordFs(this.app),
      getSnapshot: (conversationId, messageId) => this.getLearningSnapshot(conversationId, messageId),
      commit: (conversationId, messageId, update) => this.commitLearningSnapshot(conversationId, messageId, update),
    });
    return this.learningSaveService;
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

  /**
   * Returns every mounted ObsidianCode view, not just the first. Obsidian permits more
   * than one leaf of the same view type (a restored layout, a user-arranged split), and
   * `activateView()` only reuses leaf [0] — it does not prevent a second one existing.
   * State that must be visible in every open chat view (like the permission toggle)
   * has to be pushed to all of them, not just the one `getView()` happens to pick.
   */
  private getAllViews(): ObsidianCopilotView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_OBSIDIAN_COPILOT)
      .map((leaf) => leaf.view as ObsidianCopilotView);
  }

  /**
   * Marks one write-capable action (a bash expansion or a streaming provider request)
   * as started (`true`) or settled (`false`). Callers must pair every `true` with exactly
   * one later `false`, normally via `try { ... } finally { setBashExpansionActive(false) }`
   * around the action, so an overlapping second action is not unlocked by the first one
   * finishing. Repaints EVERY mounted chat view's permission toggle immediately (a
   * workspace can have more than one leaf of this view type open at once, and all of them
   * are showing state gated by this same counter); if none are mounted (e.g. an
   * inline-edit expansion with the chat view closed) there is nothing to repaint, and any
   * toggle that opens later picks up the current count when it renders anyway.
   */
  setBashExpansionActive(active: boolean): void {
    const wasInFlight = this.writeAuthorityCount > 0;
    this.writeAuthorityCount = Math.max(0, this.writeAuthorityCount + (active ? 1 : -1));
    const isInFlight = this.writeAuthorityCount > 0;
    // Capture only on the 0 -> 1 edge, so a second overlapping region (e.g. an inline-edit
    // bash expansion starting while a chat reply is still streaming) does not overwrite the
    // mode the FIRST region captured. Clear only on the edge back to 0, once every
    // overlapping region has settled.
    if (!wasInFlight && isInFlight) {
      this.capturedPermissionMode = resolveEffectivePermissionMode(
        this.settings.permissionMode,
        this.settings.selectedProvider as ProviderId,
        this.settings.blanketWriteAcknowledged
      );
    } else if (wasInFlight && !isInFlight) {
      this.capturedPermissionMode = null;
    }
    this.getAllViews().forEach((view) => view.refreshPermissionToggle());
  }

  isBashExpansionInFlight(): boolean {
    return this.writeAuthorityCount > 0;
  }

  /** The mode captured at the 0 -> 1 edge above; null when nothing is in flight. */
  getCapturedPermissionMode(): NativePermissionMode | null {
    return this.capturedPermissionMode;
  }

  /** Drop every runtime grant at a lifecycle boundary. Does not persist anything. */
  resetPermissionAuthority(): void {
    this.permissionAuthorityEpoch += 1;
    this.settings.permissionMode = 'ask';
    this.settings.blanketWriteAcknowledged = [];
    this.getAllViews().forEach((view) => view.refreshPermissionToggle());
  }

  /**
   * The toggle going back to Ask. Unlike resetPermissionAuthority this keeps the write
   * consents given this session, so flipping back to Agent does not ask again; a reload,
   * a new view or a provider switch still clears them. The epoch still moves, so a
   * consent dialog that is open right now cannot grant Agent after this.
   */
  returnToAsk(): void {
    this.permissionAuthorityEpoch += 1;
    this.settings.permissionMode = 'ask';
    this.getAllViews().forEach((view) => view.refreshPermissionToggle());
  }

  getPermissionAuthorityEpoch(): number {
    return this.permissionAuthorityEpoch;
  }
}
