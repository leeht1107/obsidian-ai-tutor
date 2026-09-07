/**
 * Secrets must not live in a file that syncs.
 *
 * `.copilot/settings.json` is described in its own header as "user-facing,
 * shareable" — it is meant to be committed and passed around. A GitHub token
 * and a block of KEY=VALUE environment variables were being written into it, so
 * a vault kept in OneDrive, iCloud or git carried the student's credentials with
 * it. Obsidian's device-local storage lives outside the vault folder, which is
 * the only place here that a sync client never sees.
 */
import type { App } from 'obsidian';

import {
  adoptSecretsFromSettings,
  readSecrets,
  writeSecrets,
} from '@/core/storage/SecretStorage';
import { SettingsStorage } from '@/core/storage/SettingsStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

/** Obsidian's device-local key/value store, in memory. */
function fakeApp(): App {
  const store = new Map<string, unknown>();
  return {
    loadLocalStorage: (key: string) => store.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => {
      if (value === null) store.delete(key);
      else store.set(key, value);
    },
  } as unknown as App;
}

describe('SecretStorage', () => {
  it('round-trips secrets through device-local storage', () => {
    const app = fakeApp();
    writeSecrets(app, { githubToken: 'github_pat_x', environmentVariables: 'A=1' });
    expect(readSecrets(app)).toEqual({ githubToken: 'github_pat_x', environmentVariables: 'A=1' });
  });

  it('returns empty strings when nothing was ever stored', () => {
    expect(readSecrets(fakeApp())).toEqual({ githubToken: '', environmentVariables: '' });
  });

  it('moves a token out of the vault settings and blanks it there', () => {
    const app = fakeApp();
    const settings = { githubToken: 'github_pat_x', environmentVariables: '', model: 'gpt-4.1' };

    expect(adoptSecretsFromSettings(app, settings)).toBe(true);

    expect(settings.githubToken).toBe('');
    expect(readSecrets(app).githubToken).toBe('github_pat_x');
    // Only the secrets move; the rest of the settings object is untouched.
    expect(settings.model).toBe('gpt-4.1');
  });

  it('moves environment variables too, since students paste API keys there', () => {
    // The settings placeholder literally suggested `GH_TOKEN=your-token`, so this
    // field is at least as likely to hold a credential as the token field is.
    const app = fakeApp();
    const settings = { githubToken: '', environmentVariables: 'OPENAI_API_KEY=sk-x' };

    expect(adoptSecretsFromSettings(app, settings)).toBe(true);
    expect(settings.environmentVariables).toBe('');
    expect(readSecrets(app).environmentVariables).toBe('OPENAI_API_KEY=sk-x');
  });

  it('reports nothing moved when the vault settings hold no secrets', () => {
    // This is what gates the one-time notice: no move, no popup.
    const app = fakeApp();
    const settings = { githubToken: '', environmentVariables: '' };
    expect(adoptSecretsFromSettings(app, settings)).toBe(false);
  });

  it('does not overwrite an existing device-local secret with an empty one', () => {
    const app = fakeApp();
    writeSecrets(app, { githubToken: 'github_pat_keep', environmentVariables: '' });
    const settings = { githubToken: '', environmentVariables: 'A=1' };

    adoptSecretsFromSettings(app, settings);

    expect(readSecrets(app).githubToken).toBe('github_pat_keep');
    expect(readSecrets(app).environmentVariables).toBe('A=1');
  });
});

describe('SettingsStorage refuses to write secrets to the vault', () => {
  it('strips them even when a caller hands them over', async () => {
    // The boundary that owns the file enforces this, not every caller of it.
    let written = '';
    const adapter = {
      exists: async () => true,
      read: async () => '{}',
      write: async (_path: string, content: string) => { written = content; },
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter);
    await storage.save({ githubToken: 'github_pat_x', environmentVariables: 'A=1', model: 'gpt-4.1' } as never);

    expect(written).not.toContain('github_pat_x');
    expect(written).not.toContain('A=1');
    expect(written).toContain('gpt-4.1');
  });
});

describe('SecretStorage migration cannot lose or clobber a credential', () => {
  /** Device-local storage that refuses every write, as a corrupt store would. */
  function brokenApp(): App {
    return {
      loadLocalStorage: () => null,
      saveLocalStorage: () => { throw new Error('QuotaExceededError'); },
    } as unknown as App;
  }

  it('leaves the vault value alone when the local write fails', () => {
    // Blanking first and persisting second is how a migration eats a token: the
    // in-memory field is cleared, the vault file is rewritten from it, and the
    // local store never received the value. Losing a student's credential is
    // worse than leaving it one more launch in a file that already held it.
    const app = brokenApp();
    const settings = { githubToken: 'github_pat_x', environmentVariables: '' };

    expect(adoptSecretsFromSettings(app, settings)).toBe(false);
    expect(settings.githubToken).toBe('github_pat_x');
  });

  it('never overwrites a device-local credential with one that synced in', () => {
    // A vault synced from another machine, or a shared template, can carry a
    // stale or placeholder token. The device-local value is the one this student
    // chose here, so it wins — but the vault copy is still cleared, because the
    // point of the move is that no credential stays in a synced file.
    const app = fakeApp();
    writeSecrets(app, { githubToken: 'github_pat_local', environmentVariables: '' });
    const settings = { githubToken: 'github_pat_stale_from_sync', environmentVariables: '' };

    expect(adoptSecretsFromSettings(app, settings)).toBe(true);
    expect(readSecrets(app).githubToken).toBe('github_pat_local');
    expect(settings.githubToken).toBe('');
  });

  it('reports the write result so a caller can tell stored from lost', () => {
    expect(writeSecrets(fakeApp(), { githubToken: 'a', environmentVariables: '' })).toBe(true);
    expect(writeSecrets(brokenApp(), { githubToken: 'a', environmentVariables: '' })).toBe(false);
  });
});
