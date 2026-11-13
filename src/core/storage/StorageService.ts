/**
 * StorageService - Main coordinator for distributed storage system.
 *
 * Manages:
 * - Settings in .ai-tutor/settings.json (user-facing, shareable)
 * - Slash commands in .ai-tutor/commands/*.md
 * - Chat sessions in .ai-tutor/sessions/*.jsonl
 * - Plugin state in data.json (machine-specific)
 *
 * Handles migration from legacy data.json format on first load.
 */

import type { App, Plugin } from 'obsidian';

import type { ProviderId } from '../providers/providerRegistry';
import type { ProviderConnections } from '../setup/providerConnection';
import type { Conversation, ObsidianCopilotSettings, SlashCommand } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { type FailureReportHost, reportBlockingFailure } from './FailureReport';
import { SESSIONS_PATH, SessionStorage } from './SessionStorage';
import { SettingsStorage, type StoredSettings } from './SettingsStorage';
import { COMMANDS_PATH, SlashCommandStorage } from './SlashCommandStorage';
import { VaultFileAdapter } from './VaultFileAdapter';

/** Base path for all plugin storage in the vault. */
export const PLUGIN_PATH = '.ai-tutor';
/** Legacy base path, checked during migration. */
export const LEGACY_PATH = '.copilot';

/** Machine-specific state stored in Obsidian's data.json. */
export interface PluginState {
  activeConversationId: string | null;
  /** Machine state that settings keep out of settings.json (SettingsStorage). */
  lastEnvHash?: string;
  migrationVersion?: number;
  /** Machine-local link between a selected Brief and its confirmed study folder. */
  studyGoalBindings?: StudyGoalBinding[];
  /**
   * Whether each provider is connected on this machine. Machine state, not
   * vault settings: it describes this student's install and login, so it must
   * not travel with a vault shared with a class.
   */
  providerConnections?: ProviderConnections;
  /** Which providers the bundled Obsidian skills were auto-installed for.
   * Per provider, because each CLI reads a different folder — and machine
   * state, because it records what this install already did to this vault. */
  skillsAutoInstalled?: Partial<Record<ProviderId, boolean>>;
  /** What the plugin did with each bundled skill, per vault-relative skills
   * root (e.g. `.agents/skills`). A `removed` entry is the student's delete:
   * it must outlive every data.json write, or the skill comes back. */
  bundledSkills?: BundledSkillRecords;
  /** This data.json predates bundledSkills (a 0.1.51 or older student). Set once, never cleared. */
  bundledSkillsLegacy?: boolean;
}

export type BundledSkillState = 'installed' | 'kept' | 'removed';

export interface BundledSkillRecord {
  version: string;
  state: BundledSkillState;
  /** sha256 per relative file path, as written by the plugin. */
  files?: Record<string, string>;
}

/** root (vault-relative) → skill name → record */
export type BundledSkillRecords = Record<string, Record<string, BundledSkillRecord>>;

export interface StudyGoalBinding {
  id: string;
  briefPath: string;
  folderPath: string;
  contextPath: string;
}

const DEFAULT_STATE: PluginState = {
  activeConversationId: null,
};

/** Legacy data format (pre-migration). */
interface LegacyData extends Partial<ObsidianCopilotSettings> {
  conversations?: Conversation[];
  slashCommands?: SlashCommand[];
  activeConversationId?: string;
  lastEnvHash?: string;
  migrationVersion?: number;
  providerConnections?: ProviderConnections;
  skillsAutoInstalled?: Partial<Record<ProviderId, boolean>>;
  bundledSkills?: BundledSkillRecords;
  bundledSkillsLegacy?: boolean;
  studyGoalBindings?: StudyGoalBinding[];
}

export class StorageService {
  readonly settings: SettingsStorage;
  readonly commands: SlashCommandStorage;
  readonly sessions: SessionStorage;

  private adapter: VaultFileAdapter;
  /** Tail of the serialised data.json write chain; see updateState. */
  private stateWrites: Promise<void> = Promise.resolve();
  private plugin: Plugin;
  private app: App;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.adapter = new VaultFileAdapter(this.app);
    this.settings = new SettingsStorage(this.adapter, this.app);
    this.commands = new SlashCommandStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
  }

  /**
   * What `reportBlockingFailure` needs, built from this service's own adapter.
   *
   * Not `this.plugin` directly: migration runs from `initialize()`, and the
   * plugin's `storage` field is not assigned until that returns — so asking the
   * plugin for its adapter during a migration failure would find nothing, in
   * exactly the case worth recording.
   */
  private failureHost(): FailureReportHost {
    const plugin = this.plugin as Plugin & FailureReportHost;
    return {
      storage: { getAdapter: () => this.adapter },
      manifest: this.plugin.manifest,
      agentService: plugin.agentService,
    };
  }

  /** Initialize storage, running migration if needed. */
  async initialize(): Promise<{
    settings: StoredSettings;
    state: PluginState;
  }> {
    await this.migrateFromLegacyPath();

    // Ensure .ai-tutor directory structure exists
    await this.ensureDirectories();

    // Check if migration is needed based on legacy data.json contents
    const settingsExist = await this.settings.exists();
    const legacyData = await this.loadLegacyData();
    if (legacyData && this.needsMigration(legacyData)) {
      console.log('[ObsidianCopilot] Migrating from legacy data.json to distributed storage...');
      const migrated = await this.runMigration(legacyData, { migrateSettings: !settingsExist });
      if (migrated) {
        console.log('[ObsidianCopilot] Migration complete.');
      } else {
        console.warn('[ObsidianCopilot] Migration incomplete; will retry on next launch.');
      }
    }

    // Load settings from .ai-tutor/settings.json
    const settings = await this.settings.load();

    // Load plugin state from data.json
    const state = await this.loadState();

    return { settings, state };
  }

  /** Check if migration is needed. */
  needsMigration(legacyData: LegacyData | null): boolean {
    if (!legacyData) return false;

    // Check if there's data to migrate
    const hasConversations = legacyData.conversations && legacyData.conversations.length > 0;
    const hasSlashCommands = legacyData.slashCommands && legacyData.slashCommands.length > 0;
    const stateKeys = new Set([
      'conversations',
      'slashCommands',
      'activeConversationId',
      'lastEnvHash',
      'migrationVersion',
      'providerConnections',
      'skillsAutoInstalled',
      'bundledSkills',
      'bundledSkillsLegacy',
      'studyGoalBindings',
    ]);
    const hasSettings = Object.keys(legacyData).some(key => !stateKeys.has(key));

    return hasConversations || hasSlashCommands || hasSettings;
  }

  /** Run migration from legacy data.json to distributed storage. */
  async runMigration(
    legacyData: LegacyData,
    options: { migrateSettings: boolean } = { migrateSettings: true }
  ): Promise<boolean> {
    let hadErrors = false;

    // 1. Migrate settings (exclude state fields and slashCommands)
    if (options.migrateSettings) {
      try {
        await this.migrateSettings(legacyData);
      } catch (error) {
        hadErrors = true;
        console.error('[ObsidianCopilot] Failed to migrate settings:', error);
      }
    }

    // 2. Migrate slash commands to individual files
    if (await this.migrateSlashCommands(legacyData.slashCommands || [])) {
      hadErrors = true;
    }

    // 3. Migrate conversations to individual JSONL files
    if (await this.migrateConversations(legacyData.conversations || [])) {
      hadErrors = true;
    }

    if (hadErrors) {
      return false;
    }

    // 4. Update data.json to state-only format, in the same queue as every other state write
    // Against the state as it is now, not as `legacyData` saw it: a record
    // written since that read is newer and stays.
    await this.enqueueStateWrite(async (current) => ({
      activeConversationId: current.activeConversationId ?? legacyData.activeConversationId ?? null,
      providerConnections: current.providerConnections ?? legacyData.providerConnections,
      skillsAutoInstalled: current.skillsAutoInstalled ?? legacyData.skillsAutoInstalled,
      bundledSkills: current.bundledSkills ?? legacyData.bundledSkills,
      bundledSkillsLegacy: current.bundledSkillsLegacy ?? legacyData.bundledSkillsLegacy,
      studyGoalBindings: current.studyGoalBindings ?? legacyData.studyGoalBindings,
    }));

    return true;
  }

  /** Load legacy data from Obsidian's data.json. */
  private async loadLegacyData(): Promise<LegacyData | null> {
    try {
      const data = await this.plugin.loadData();
      return data || null;
    } catch {
      return null;
    }
  }

  /** Load plugin state from data.json. */
  async loadState(): Promise<PluginState> {
    try {
      return await this.readStateStrict();
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  /** loadState for a write: a failed read throws, so defaults never overwrite real state. */
  private async readStateStrict(): Promise<PluginState> {
    const data = await this.plugin.loadData();
    return {
        activeConversationId: data?.activeConversationId ?? DEFAULT_STATE.activeConversationId,
        ...(data?.lastEnvHash !== undefined ? { lastEnvHash: data.lastEnvHash } : {}),
        ...(data?.migrationVersion !== undefined ? { migrationVersion: data.migrationVersion } : {}),
        providerConnections: data?.providerConnections ?? undefined,
        skillsAutoInstalled: data?.skillsAutoInstalled ?? undefined,
        bundledSkills: data?.bundledSkills ?? undefined,
        bundledSkillsLegacy: data?.bundledSkillsLegacy ?? undefined,
        studyGoalBindings: data?.studyGoalBindings ?? undefined,
      };
  }

  /** Save plugin state to data.json. */
  async saveState(state: PluginState): Promise<void> {
    await this.plugin.saveData(state);
  }

  /**
   * Merge one skills root's records into state, inside the same serialized
   * chain as updateState. A `removed` record already stored wins over
   * anything else: a Remove click that lands while an install is running
   * must not be undone by the install's older view of the folder.
   */
  async mergeBundledSkills(root: string, records: Record<string, BundledSkillRecord>): Promise<void> {
    return this.enqueueStateWrite(async (current) => {
      const all = { ...(current.bundledSkills ?? {}) };
      const merged = { ...(all[root] ?? {}) };
      for (const [name, record] of Object.entries(records)) {
        if (merged[name]?.state === 'removed' && record.state !== 'removed') continue;
        merged[name] = record;
      }
      all[root] = merged;
      return { bundledSkills: all };
    });
  }

  /** Forget records so the next ensure installs again (the Settings Install button). */
  async clearBundledSkills(root: string, names: string[]): Promise<void> {
    return this.enqueueStateWrite(async (current) => {
      const all = { ...(current.bundledSkills ?? {}) };
      const kept = { ...(all[root] ?? {}) };
      for (const name of names) delete kept[name];
      all[root] = kept;
      return { bundledSkills: all };
    });
  }

  private enqueueStateWrite(build: (current: PluginState) => Promise<Partial<PluginState>>): Promise<void> {
    const write = this.stateWrites.then(async () => {
      const current = await this.readStateStrict();
      await this.saveState({ ...current, ...(await build(current)) });
    });
    this.stateWrites = write.catch(() => undefined);
    return write;
  }

  /**
   * Update specific state fields in data.json.
   *
   * Serialised, because this is a read-modify-write and the settings tab now
   * checks four providers at once. Run in parallel, two updates both read the
   * state as it was before either wrote, and whichever saves last erases the
   * other one's verdict.
   */
  async updateState(updates: Partial<PluginState>): Promise<void> {
    const write = this.stateWrites.then(async () => {
      const current = await this.readStateStrict();
      await this.saveState({ ...current, ...updates });
    });
    // A rejected write must not wedge every later one behind it.
    this.stateWrites = write.catch(() => undefined);
    return write;
  }

  /**
   * Migrate legacy .copilot/settings.json to .ai-tutor/settings.json.
   * Credentials and trust fields in the preserved legacy file are sanitized
   * so secrets do not linger. If reading or parsing legacy JSON fails,
   * settings migration is aborted to prevent data loss, but commands and
   * sessions migration can still proceed.
   * If sanitization write fails, it fails closed by throwing an error.
   */
  private async migrateLegacySettings(): Promise<void> {
    const legacySettingsPath = `${LEGACY_PATH}/settings.json`;
    if (!(await this.adapter.exists(legacySettingsPath))) {
      return;
    }

    const { containsProhibitedKeys, stripTrustFields } = await import('./SecretStorage');

    const legacyContent = await this.adapter.read(legacySettingsPath);
    const hasRawForbidden = containsProhibitedKeys(legacyContent);


    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(legacyContent) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Legacy settings is not an object');
      }
    } catch (error) {
      if (hasRawForbidden) {
        console.error('[obsidian-ai-tutor] Legacy settings file is malformed and contains credentials/trust fields. Migration aborted.');
        // A blocking failure at startup with a sticky notice, and until now no
        // record: the student is told to inspect a file by hand and the plugin
        // kept no evidence of why it asked.
        reportBlockingFailure(this.failureHost(), {
          notice: '이전 버전 설정 파일(.copilot/settings.json)이 손상되어 보안 정보를 안전하게 정리할 수 없습니다. 보안을 위해 해당 파일을 수동으로 확인하거나 삭제해 주세요.',
          stage: 'internal',
          detail: error instanceof Error ? error.message : String(error),
          durationMs: 0,
        });
        throw new Error(
          '[obsidian-ai-tutor] Legacy .copilot/settings.json is malformed and contains prohibited security fields. Migration aborted.'
        );
      }
      console.error('[obsidian-ai-tutor] Failed to read or parse legacy settings JSON, skipping settings migration:', error);
      return;
    }

    const sanitized = stripTrustFields(parsed);
    delete (sanitized as Record<string, unknown>).githubToken;
    delete (sanitized as Record<string, unknown>).environmentVariables;

    // Sanitize legacy settings file
    try {
      await this.adapter.write(legacySettingsPath, JSON.stringify(sanitized, null, 2));
    } catch (error) {
      console.error('[obsidian-ai-tutor] Failed to sanitize legacy settings file:', error);
      reportBlockingFailure(this.failureHost(), {
        notice: '이전 버전 설정 파일(.copilot/settings.json)의 보안 정보를 정리하지 못해 마이그레이션을 중단했습니다. 파일 쓰기 권한을 확인해 주세요.',
        stage: 'internal',
        detail: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      });
      throw new Error('[obsidian-ai-tutor] Failed to sanitize legacy credentials in .copilot/settings.json');
    }

    if (!(await this.adapter.exists(`${PLUGIN_PATH}/settings.json`))) {
      await this.adapter.write(`${PLUGIN_PATH}/settings.json`, JSON.stringify(sanitized, null, 2));
    }
  }

  /**
   * One-time migration: if .copilot/ exists, copy settings, commands, and
   * sessions to .ai-tutor/ without overwriting existing files.
   * Credentials and trust fields in the preserved legacy .copilot/settings.json
   * are sanitized so secrets do not linger in the legacy directory.
   */
  private async migrateFromLegacyPath(): Promise<void> {
    const hasLegacy = await this.adapter.exists(LEGACY_PATH);
    if (!hasLegacy) return;

    console.log('[obsidian-ai-tutor] Checking migration from .copilot/ → .ai-tutor/...');

    await this.adapter.ensureFolder(PLUGIN_PATH);

    // 1. Migrate settings if .ai-tutor/settings.json doesn't exist yet
    await this.migrateLegacySettings();

    // 2. Commands: copy any missing files from legacy to new
    await this.copyMissingFiles(`${LEGACY_PATH}/commands`, COMMANDS_PATH);

    // 3. Sessions: copy any missing files from legacy to new
    await this.copyMissingFiles(`${LEGACY_PATH}/sessions`, SESSIONS_PATH);

    console.log('[obsidian-ai-tutor] Migration check complete.');
  }

  private async copyMissingFiles(src: string, dst: string): Promise<void> {
    if (!(await this.adapter.exists(src))) return;
    await this.adapter.ensureFolder(dst);
    const files = await this.adapter.listFilesRecursive(src);
    for (const file of files) {
      const relativePath = file.startsWith(`${src}/`) ? file.substring(src.length + 1) : file;
      const targetPath = `${dst}/${relativePath}`;
      if (!(await this.adapter.exists(targetPath))) {
        const content = await this.adapter.read(file);
        await this.adapter.write(targetPath, content);
      }
    }
  }

  /** Ensure all required directories exist. */
  async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(PLUGIN_PATH);
    await this.adapter.ensureFolder(COMMANDS_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
  }

  /** Migrate settings from legacy format. */
  private async migrateSettings(legacyData: LegacyData): Promise<void> {
    // Extract settings fields (exclude state fields, slashCommands, conversations)
    const {
      slashCommands: _,
      conversations: __,
      activeConversationId: ___,
      lastEnvHash: ____,
      migrationVersion: _____,
      providerConnections: ______,
      skillsAutoInstalled: _______,
      bundledSkills: _________,
      bundledSkillsLegacy: __________,
      studyGoalBindings: ________,
      ...settingsFields
    } = legacyData;

    // Merge with defaults (permissions is now part of settings)
    const settings: StoredSettings = {
      ...this.getDefaultSettings(),
      ...settingsFields,
    };

    await this.settings.save(settings);
  }

  /** Migrate slash commands to individual files. */
  private async migrateSlashCommands(commands: SlashCommand[]): Promise<boolean> {
    let hadErrors = false;
    for (const command of commands) {
      try {
        const filePath = this.commands.getFilePath(command);
        if (await this.adapter.exists(filePath)) {
          continue;
        }
        await this.commands.save(command);
      } catch (error) {
        hadErrors = true;
        console.error(`[ObsidianCopilot] Failed to migrate command ${command.name}:`, error);
      }
    }
    return hadErrors;
  }

  /** Migrate conversations to individual JSONL files. */
  private async migrateConversations(conversations: Conversation[]): Promise<boolean> {
    let hadErrors = false;
    for (const conversation of conversations) {
      try {
        const filePath = this.sessions.getFilePath(conversation.id);
        if (await this.adapter.exists(filePath)) {
          continue;
        }
        await this.sessions.saveConversation(conversation);
      } catch (error) {
        hadErrors = true;
        console.error(`[ObsidianCopilot] Failed to migrate conversation ${conversation.id}:`, error);
      }
    }
    return hadErrors;
  }

  /** Get default settings (excluding state fields and slashCommands). */
  private getDefaultSettings(): StoredSettings {
    const {
      slashCommands: _,
      lastEnvHash: __,
      ...defaults
    } = DEFAULT_SETTINGS;
    return defaults;
  }

  /** Get the vault file adapter for direct file operations. */
  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }
}
