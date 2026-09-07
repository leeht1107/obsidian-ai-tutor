/**
 * SettingsStorage - Handles settings.json read/write in vault/.ai-tutor/
 *
 * Settings are stored as JSON in the vault's .ai-tutor/settings.json file.
 * This replaces the previous approach of storing settings in Obsidian's data.json.
 *
 * User-facing settings go here (including permissions, like Claude Code).
 * Machine-specific state (lastEnvHash, model tracking) stays in Obsidian's data.json.
 */

import type { App } from 'obsidian';

import type { ObsidianCopilotSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import type { StoredSecrets } from './SecretStorage';
import { containsProhibitedKeys, stripTrustFields, TRUST_FIELDS } from './SecretStorage';
import type { VaultFileAdapter } from './VaultFileAdapter';

/** Fields that are machine-specific state or loaded separately. */
type StateFields =
  | 'slashCommands'
  | 'lastEnvHash';

/** Settings stored in .ai-tutor/settings.json (user-facing, shareable). */
export type StoredSettings = Omit<ObsidianCopilotSettings, StateFields>;

/** Path to settings file relative to vault root. */
export const SETTINGS_PATH = '.ai-tutor/settings.json';
export const LEGACY_SETTINGS_PATH = '.copilot/settings.json';


export class SettingsStorage {
  constructor(private adapter: VaultFileAdapter, _app?: App) {}

  /** Load settings from .ai-tutor/settings.json, merging with defaults. */
  async load(): Promise<StoredSettings> {
    try {
      if (!(await this.adapter.exists(SETTINGS_PATH))) {
        return this.getDefaults();
      }

      const content = await this.adapter.read(SETTINGS_PATH);
      const hasRawForbidden = containsProhibitedKeys(content);

      let stored: Record<string, unknown>;
      try {
        stored = JSON.parse(content) as Record<string, unknown>;
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
          throw new Error('Settings JSON is not a valid object');
        }
      } catch (parseErr) {
        if (hasRawForbidden) {
          console.error('[obsidian-ai-tutor] Settings file is malformed and contains prohibited security fields. Initialization aborted.');
          throw new Error(
            `[obsidian-ai-tutor] ${SETTINGS_PATH} is malformed and contains prohibited security fields. Initialization aborted.`
          );
        }
        console.warn('[obsidian-ai-tutor] Failed to parse settings JSON, using defaults:', parseErr);
        return this.getDefaults();
      }

      const hasForbiddenKeys =
        'githubToken' in stored ||
        'environmentVariables' in stored ||
        TRUST_FIELDS.some(f => f in stored);

      // Trust fields and credentials in vault JSON are stripped — device-local storage is authoritative.
      const vaultSafe = stripTrustFields(stored) as Record<string, unknown>;
      delete vaultSafe.githubToken;
      delete vaultSafe.environmentVariables;

      if (hasForbiddenKeys) {
        try {
          await this.adapter.write(SETTINGS_PATH, JSON.stringify(vaultSafe, null, 2));
        } catch (err) {
          console.error('[obsidian-ai-tutor] Failed to rewrite sanitized settings:', err);
          throw new Error(
            `[obsidian-ai-tutor] Failed to sanitize prohibited security fields in ${SETTINGS_PATH}. File rewrite failed.`
          );
        }
      }

      return {
        ...this.getDefaults(),
        ...vaultSafe,
      } as StoredSettings;
    } catch (error) {
      if (error instanceof Error && error.message.includes('[obsidian-ai-tutor]')) {
        throw error;
      }
      console.error('[ObsidianCopilot] Failed to load settings:', error);
      return this.getDefaults();
    }
  }

  /** Save settings to .ai-tutor/settings.json. */
  async save(settings: StoredSettings): Promise<void> {
    try {
      // This file is shareable by design, so credentials must not reach it even
      // if a caller hands them over. SecretStorage owns them instead, in
      // device-local storage that no sync client copies.
      const { githubToken: _token, environmentVariables: _env, ...safe } =
        settings as StoredSettings & Partial<StoredSecrets>;
      // Trust fields and credentials must not reach the vault file.
      const vaultSafe = stripTrustFields(safe as Record<string, unknown>);
      const content = JSON.stringify(vaultSafe, null, 2);
      await this.adapter.write(SETTINGS_PATH, content);
    } catch (error) {
      console.error('[ObsidianCopilot] Failed to save settings:', error);
      throw error;
    }
  }

  /** Check if settings file exists. */
  async exists(): Promise<boolean> {
    return this.adapter.exists(SETTINGS_PATH);
  }

  /** Get default settings (excluding state fields). */
  private getDefaults(): StoredSettings {
    const {
      slashCommands: _,
      lastEnvHash: __,
      ...defaults
    } = DEFAULT_SETTINGS;
    return defaults;
  }
}
