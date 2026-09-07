/**
 * SecretStorage — credentials and trust state, kept out of the vault.
 *
 * Everything else this plugin stores lives in `.ai-tutor/settings.json`, which is
 * described in its own header as "user-facing, shareable": it is meant to be
 * committed and handed to a classmate. Credentials (GitHub token, environment
 * variables) and device-local trust state (permission modes, approved permissions,
 * blocklists, CLI paths, export paths) must not travel with a shared vault.
 *
 * Obsidian's device-local storage is the only store here that a sync client never
 * sees — `data.json` would not do, because it sits inside `.obsidian/` in the
 * vault folder like everything else.
 *
 * The cost is real and deliberate: opening the same vault on a second machine
 * finds no token or trust state there. SecretMoveNoticeModal says so in as many words.
 */
import type { App } from 'obsidian';
import { Notice } from 'obsidian';

import {
  type EnvSnippet,
  getDefaultBlockedCommands,
  type NonPlanPermissionMode,
  type Permission,
  type PermissionMode,
  type PlatformBlockedCommands,
  type SelectedProvider,
} from '../types/settings';

const STORAGE_KEY = 'obsidian-ai-tutor:secrets';

export interface StoredSecrets {
  githubToken: string;
  environmentVariables: string;
}

/** Settings fields that hold credentials and therefore never reach the vault file. */
export const SECRET_FIELDS = ['githubToken', 'environmentVariables'] as const;

const EMPTY: StoredSecrets = { githubToken: '', environmentVariables: '' };

export function readSecrets(app: App): StoredSecrets {
  try {
    const raw = app.loadLocalStorage(STORAGE_KEY) as Partial<StoredSecrets> | null;
    if (!raw || typeof raw !== 'object') return { ...EMPTY };
    return {
      githubToken: typeof raw.githubToken === 'string' ? raw.githubToken : '',
      environmentVariables: typeof raw.environmentVariables === 'string' ? raw.environmentVariables : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Returns whether the write actually landed. Callers must not discard a value on false. */
export function writeSecrets(app: App, secrets: StoredSecrets): boolean {
  try {
    app.saveLocalStorage(STORAGE_KEY, {
      githubToken: secrets.githubToken ?? '',
      environmentVariables: secrets.environmentVariables ?? '',
    });
    return true;
  } catch (error) {
    console.warn('[ObsidianCopilot] Failed to store secrets locally:', error);
    return false;
  }
}

/**
 * Write, and tell the student when the credential did not actually land.
 *
 * `writeSecrets` returns whether the write happened, and its only caller was
 * discarding that answer. A failed device-local write then looked identical to a
 * success: the settings field still shows the token because it is held in
 * memory, and the vault file no longer carries a copy to fall back on, so the
 * loss surfaces only at the next launch — as a token the student is sure they
 * entered. Aborting the whole settings save would be worse; it would throw away
 * unrelated changes to a file that never holds the secret anyway. Saying so at
 * the moment it fails costs one retry instead of one mystery.
 */
export function writeSecretsOrNotify(app: App, secrets: StoredSecrets): boolean {
  if (writeSecrets(app, secrets)) return true;
  new Notice(
    '인증 정보를 이 컴퓨터에 저장하지 못했습니다. Obsidian을 다시 켜면 값이 비어 있을 수 있으니, '
    + '설정 화면에서 다시 입력해 주세요.',
    10000
  );
  return false;
}

/**
 * Move any credentials still sitting in the vault settings into device-local
 * storage, blanking them in `settings`. Returns whether anything moved — that
 * answer is what decides whether the student sees the one-time notice, and
 * whether the caller rewrites the vault file.
 *
 * Three rules, each protecting against a way this can eat a credential:
 *
 * - An empty vault value never overwrites a stored one. On the second launch the
 *   vault fields are already blank, and treating that as "clear the token" would
 *   undo the first launch's move.
 * - A device-local value already present wins over whatever the vault holds. The
 *   vault file syncs, so its copy may be stale or a shared template's placeholder;
 *   the local one is what this student set on this machine. The vault copy is
 *   still cleared — no credential stays in a synced file either way.
 * - Nothing is blanked until the local write has actually landed. Persisting
 *   second and clearing first is how a failed write turns a migration into
 *   credential loss; leaving the token one more launch in a file that already
 *   held it is the lesser harm, and the next launch retries.
 */
export function adoptSecretsFromSettings(app: App, settings: Partial<StoredSecrets>): boolean {
  const stored = readSecrets(app);
  const pending: typeof SECRET_FIELDS[number][] = [];

  for (const field of SECRET_FIELDS) {
    const value = settings[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    if (stored[field].length === 0) stored[field] = value;
    pending.push(field);
  }

  if (pending.length === 0) return false;
  if (!writeSecrets(app, stored)) return false;

  for (const field of pending) settings[field] = '';
  return true;
}

// ---------------------------------------------------------------------------
// Trust state — device-local authority fields that must not travel with a vault
// ---------------------------------------------------------------------------

const TRUST_STORAGE_KEY = 'obsidian-ai-tutor:trust';

/** Fields whose effective value comes from device-local storage, never the vault. */
export const TRUST_FIELDS = [
  'permissionMode', 'lastNonPlanPermissionMode',
  'blanketWriteAcknowledged', 'permissions',
  'enableInlineBash', 'enableBlocklist', 'blockedCommands',
  'providerCliPaths', 'copilotCliPath',
  'allowedExportPaths', 'envSnippets',
] as const;

export interface StoredTrust {
  permissionMode: PermissionMode;
  lastNonPlanPermissionMode?: NonPlanPermissionMode;
  blanketWriteAcknowledged: string[];
  permissions: Permission[];
  enableInlineBash: boolean;
  enableBlocklist: boolean;
  blockedCommands: PlatformBlockedCommands;
  providerCliPaths: Partial<Record<SelectedProvider, string>>;
  copilotCliPath: string;
  allowedExportPaths: string[];
  envSnippets: EnvSnippet[];
}

function isPermissionMode(v: unknown): v is PermissionMode {
  return v === 'agent' || v === 'ask' || v === 'plan';
}

export function getDefaultTrust(): StoredTrust {
  return {
    permissionMode: 'agent',
    blanketWriteAcknowledged: [],
    permissions: [],
    enableInlineBash: false,
    enableBlocklist: true,
    blockedCommands: getDefaultBlockedCommands(),
    providerCliPaths: {},
    copilotCliPath: '',
    allowedExportPaths: ['~/Desktop', '~/Downloads'],
    envSnippets: [],
  };
}

export function readTrust(app: App): StoredTrust {
  try {
    const raw = app.loadLocalStorage(TRUST_STORAGE_KEY) as Partial<StoredTrust> | null;
    if (!raw || typeof raw !== 'object') return getDefaultTrust();
    const defaults = getDefaultTrust();
    return {
      permissionMode: isPermissionMode(raw.permissionMode) ? raw.permissionMode : defaults.permissionMode,
      lastNonPlanPermissionMode: raw.lastNonPlanPermissionMode === 'agent' || raw.lastNonPlanPermissionMode === 'ask'
        ? raw.lastNonPlanPermissionMode : undefined,
      blanketWriteAcknowledged: Array.isArray(raw.blanketWriteAcknowledged) ? raw.blanketWriteAcknowledged : [],
      permissions: Array.isArray(raw.permissions) ? raw.permissions : [],
      enableInlineBash: typeof raw.enableInlineBash === 'boolean' ? raw.enableInlineBash : defaults.enableInlineBash,
      enableBlocklist: typeof raw.enableBlocklist === 'boolean' ? raw.enableBlocklist : defaults.enableBlocklist,
      blockedCommands: raw.blockedCommands && typeof raw.blockedCommands === 'object'
        ? raw.blockedCommands as PlatformBlockedCommands : defaults.blockedCommands,
      providerCliPaths: raw.providerCliPaths && typeof raw.providerCliPaths === 'object'
        ? raw.providerCliPaths as Partial<Record<SelectedProvider, string>> : {},
      copilotCliPath: typeof raw.copilotCliPath === 'string' ? raw.copilotCliPath : '',
      allowedExportPaths: Array.isArray(raw.allowedExportPaths) ? raw.allowedExportPaths : defaults.allowedExportPaths,
      envSnippets: Array.isArray(raw.envSnippets) ? raw.envSnippets : [],
    };
  } catch {
    return getDefaultTrust();
  }
}

export function writeTrust(app: App, trust: StoredTrust): boolean {
  try {
    app.saveLocalStorage(TRUST_STORAGE_KEY, trust);
    return true;
  } catch (error) {
    console.warn('[obsidian-ai-tutor] Failed to store trust state locally:', error);
    return false;
  }
}

/**
 * Write trust state, and notify the student if device-local storage fails.
 */
export function writeTrustOrNotify(app: App, trust: StoredTrust): boolean {
  if (writeTrust(app, trust)) return true;
  new Notice(
    '보안 및 권한 설정을 이 컴퓨터에 저장하지 못했습니다. Obsidian을 다시 켜면 기본값으로 재설정될 수 있으니 설정 화면을 확인해 주세요.',
    10000
  );
  return false;
}



/** Strip trust fields from an object before writing to vault. */
export function stripTrustFields<T extends Record<string, unknown>>(obj: T): Omit<T, typeof TRUST_FIELDS[number]> {
  const result: Record<string, unknown> = { ...obj };
  for (const field of TRUST_FIELDS) {
    delete result[field];
  }
  return result as Omit<T, typeof TRUST_FIELDS[number]>;
}

/**
 * Detect whether raw JSON content contains prohibited keys (credentials or trust fields).
 * Normalizes unicode escape sequences (e.g. \u0068 -> h) to prevent escape-based bypasses
 * in malformed files that cannot be parsed as JSON objects.
 */
export function containsProhibitedKeys(rawContent: string): boolean {
  const normalized = rawContent.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return _;
    }
  });

  return (
    normalized.includes('githubToken') ||
    normalized.includes('environmentVariables') ||
    TRUST_FIELDS.some(f => normalized.includes(f))
  );
}


