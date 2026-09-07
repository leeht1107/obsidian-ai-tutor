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
// The Notice the student actually sees is the point of writeSecretsOrNotify, so
// the mock has to record it rather than swallow it.
const noticeMessages: string[] = [];
jest.mock('obsidian', () => ({
  ...jest.requireActual('obsidian'),
  Notice: class {
    constructor(message: string) {
      noticeMessages.push(message);
    }
  },
}));

import type { App } from 'obsidian';

import {
  adoptSecretsFromSettings,
  containsProhibitedKeys,
  getDefaultTrust,
  readSecrets,
  readTrust,
  writeSecrets,
  writeSecretsOrNotify,
  writeTrustOrNotify,
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

beforeEach(() => {
  noticeMessages.length = 0;
});

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

  it('strips trust fields before saving to the vault', async () => {
    let written = '';
    const adapter = {
      exists: async () => true,
      read: async () => '{}',
      write: async (_path: string, content: string) => { written = content; },
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter);
    await storage.save({
      model: 'gpt-4.1',
      permissionMode: 'ask',
      enableInlineBash: true,
      copilotCliPath: '/usr/local/bin/copilot',
    } as never);

    const parsed = JSON.parse(written);
    expect(parsed.model).toBe('gpt-4.1');
    expect(parsed.permissionMode).toBeUndefined();
    expect(parsed.enableInlineBash).toBeUndefined();
    expect(parsed.copilotCliPath).toBeUndefined();
  });

  it('strips trust fields when loading from the vault', async () => {
    const vaultContent = JSON.stringify({
      model: 'claude-sonnet-4-5',
      permissionMode: 'plan',
      enableInlineBash: true,
      copilotCliPath: '/usr/bin/malicious-binary',
    });

    const adapter = {
      exists: async () => true,
      read: async () => vaultContent,
      write: async () => {},
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter);
    const loaded = await storage.load();

    expect(loaded.model).toBe('claude-sonnet-4-5');
    // Defaults are preserved because vault's trust fields were stripped
    expect(loaded.permissionMode).toBe('agent');
    expect(loaded.enableInlineBash).toBe(false);
    expect(loaded.copilotCliPath).toBe('');
  });

  it('never adopts trust fields from vault into device-local storage (untrusted vault cannot dictate trust)', async () => {
    let writtenContent = '';
    const app = fakeApp();
    const vaultContent = JSON.stringify({
      model: 'claude-sonnet-4-5',
      githubToken: 'ghp_secret_token',
      environmentVariables: 'ATTACKER_ENV=evil',
      permissionMode: 'ask',
      enableInlineBash: true,
      copilotCliPath: '/custom/bin/copilot',
    });

    const adapter = {
      exists: async () => true,
      read: async () => vaultContent,
      write: async (_p: string, c: string) => { writtenContent = c; },
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter, app);
    const loaded = await storage.load();

    // Trust fields stripped from loaded settings
    expect(loaded.permissionMode).toBe('agent');
    expect(loaded.enableInlineBash).toBe(false);
    expect(loaded.copilotCliPath).toBe('');
    expect(loaded.model).toBe('claude-sonnet-4-5');

    // Trust fields were NOT adopted into device-local storage (remains safe defaults)
    const localTrust = readTrust(app);
    expect(localTrust.permissionMode).toBe('agent');
    expect(localTrust.enableInlineBash).toBe(false);
    expect(localTrust.copilotCliPath).toBe('');

    // Secrets were NOT adopted into device-local storage
    const localSecrets = readSecrets(app);
    expect(localSecrets.githubToken).toBe('');
    expect(localSecrets.environmentVariables).toBe('');

    // On-disk file was rewritten without forbidden keys
    expect(writtenContent).not.toBe('');
    const rewritten = JSON.parse(writtenContent);
    expect(rewritten.copilotCliPath).toBeUndefined();
    expect(rewritten.enableInlineBash).toBeUndefined();
    expect(rewritten.githubToken).toBeUndefined();
    expect(rewritten.environmentVariables).toBeUndefined();
  });

  it('never adopts secrets or environment variables from vault into device-local storage (untrusted vault cannot dictate env)', async () => {
    const app = fakeApp();
    const vaultContent = JSON.stringify({
      environmentVariables: 'PATH=/attacker-controlled',
      githubToken: 'ghp_attacker_token',
      model: 'gpt-4.1',
    });

    const adapter = {
      exists: async () => true,
      read: async () => vaultContent,
      write: async () => {},
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter, app);
    const loaded = await storage.load();

    expect(loaded.environmentVariables).toBe('');
    expect(loaded.githubToken).toBe('');
    expect(readSecrets(app).environmentVariables).toBe('');
    expect(readSecrets(app).githubToken).toBe('');
  });

  it('rejects and fails closed when rewriting a contaminated settings file fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const vaultContent = JSON.stringify({
      model: 'claude-sonnet-4-5',
      githubToken: 'ghp_secret_token',
      copilotCliPath: '/usr/bin/malicious-binary',
    });

    const adapter = {
      exists: async () => true,
      read: async () => vaultContent,
      write: async () => {
        throw new Error('EACCES: permission denied');
      },
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter);
    await expect(storage.load()).rejects.toThrow(
      '[obsidian-ai-tutor] Failed to sanitize prohibited security fields in .ai-tutor/settings.json. File rewrite failed.'
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('rejects and fails closed when settings file is malformed and contains prohibited security fields', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const malformedContent = '{"githubToken":"ghp_leak", malformed_json...';

    const adapter = {
      exists: async () => true,
      read: async () => malformedContent,
      write: async () => {},
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter);
    await expect(storage.load()).rejects.toThrow(
      '[obsidian-ai-tutor] .ai-tutor/settings.json is malformed and contains prohibited security fields. Initialization aborted.'
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[obsidian-ai-tutor] Settings file is malformed and contains prohibited security fields. Initialization aborted.'
    );
    consoleErrorSpy.mockRestore();
  });

  it.each([
    ['escaped githubToken', '{"git\\u0068ubToken":"ghp_leak", malformed_json'],
    ['escaped environmentVariables', '{"\\u0065nvironmentVariables":"A=1", malformed_json'],
    ['escaped copilotCliPath', '{"\\u0063opilotCliPath":"/bin/evil", malformed_json'],
  ])('rejects and fails closed when settings file is malformed and contains escaped prohibited key: %s', async (_name, malformedContent) => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const adapter = {
      exists: async () => true,
      read: async () => malformedContent,
      write: async () => {},
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter);
    await expect(storage.load()).rejects.toThrow(
      '[obsidian-ai-tutor] .ai-tutor/settings.json is malformed and contains prohibited security fields. Initialization aborted.'
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[obsidian-ai-tutor] Settings file is malformed and contains prohibited security fields. Initialization aborted.'
    );
    consoleErrorSpy.mockRestore();
  });

  it('falls back to defaults when settings file is malformed without prohibited security fields', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const malformedContent = '{"model":"gpt-4.1", invalid_json...';

    const adapter = {
      exists: async () => true,
      read: async () => malformedContent,
      write: async () => {},
    } as unknown as VaultFileAdapter;

    const storage = new SettingsStorage(adapter);
    const loaded = await storage.load();

    expect(loaded.permissionMode).toBe('agent');
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });
});

describe('containsProhibitedKeys', () => {
  it('detects unescaped prohibited keys', () => {
    expect(containsProhibitedKeys('{"githubToken":"ghp_leak"}')).toBe(true);
    expect(containsProhibitedKeys('{"environmentVariables":"A=1"}')).toBe(true);
    expect(containsProhibitedKeys('{"copilotCliPath":"/bin/evil"}')).toBe(true);
    expect(containsProhibitedKeys('{"model":"gpt-4.1"}')).toBe(false);
  });

  it('detects unicode-escaped prohibited keys', () => {
    expect(containsProhibitedKeys('{"git\\u0068ubToken":"ghp_leak"}')).toBe(true);
    expect(containsProhibitedKeys('{"\\u0065nvironmentVariables":"A=1"}')).toBe(true);
    expect(containsProhibitedKeys('{"\\u0063opilotCliPath":"/bin/evil"}')).toBe(true);
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

  describe('writeSecretsOrNotify', () => {
    // The return value of writeSecrets was being discarded at its only call site.
    // A failed device-local write then looked exactly like a successful one: the
    // field still shows the token because it is in memory, and the loss only
    // appears at the next launch. The vault file no longer carries the value, so
    // there is nothing left to fall back to. Telling the student at the moment it
    // fails is what turns silent loss into one retry.
    it('says nothing when the write lands', () => {
      expect(writeSecretsOrNotify(fakeApp(), { githubToken: 'a', environmentVariables: '' })).toBe(true);
      expect(noticeMessages).toHaveLength(0);
    });

    it('tells the student in Korean when the write did not land', () => {
      expect(writeSecretsOrNotify(brokenApp(), { githubToken: 'a', environmentVariables: '' })).toBe(false);
      expect(noticeMessages).toHaveLength(1);
      expect(noticeMessages[0]).toContain('저장하지 못했습니다');
    });
  });

  describe('writeTrustOrNotify', () => {
    it('says nothing when the write lands', () => {
      expect(writeTrustOrNotify(fakeApp(), getDefaultTrust())).toBe(true);
      expect(noticeMessages).toHaveLength(0);
    });

    it('tells the student in Korean when the write did not land', () => {
      expect(writeTrustOrNotify(brokenApp(), getDefaultTrust())).toBe(false);
      expect(noticeMessages).toHaveLength(1);
      expect(noticeMessages[0]).toContain('보안 및 권한 설정을 이 컴퓨터에 저장하지 못했습니다');
    });
  });
});
