/**
 * SecretStorage — credentials, kept out of the vault.
 *
 * Everything else this plugin stores lives in `.copilot/settings.json`, which is
 * described in its own header as "user-facing, shareable": it is meant to be
 * committed and handed to a classmate. A GitHub token and a block of KEY=VALUE
 * environment variables were being written there too, so a vault kept in
 * OneDrive, iCloud or git carried the student's credentials along with the notes.
 *
 * Obsidian's device-local storage is the only store here that a sync client never
 * sees — `data.json` would not do, because it sits inside `.obsidian/` in the
 * vault folder like everything else.
 *
 * The cost is real and deliberate: opening the same vault on a second machine
 * finds no token there. SecretMoveNoticeModal says so in as many words.
 */
import type { App } from 'obsidian';

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
