/**
 * The record of which bundled skills a student removed must survive every
 * write to data.json. In 0.1.51 saveSettings wrote the whole state object with
 * two fields, so a provider switch in the chat popover erased
 * skillsAutoInstalled and a removed skill could come back on the next launch.
 */
const mockNoticeOpen = jest.fn();
const mockAgyOpen = jest.fn();
jest.mock('@/ui/modals/AgyWebSearchNoticeModal', () => ({
  AgyWebSearchNoticeModal: jest.fn().mockImplementation(() => ({ open: mockAgyOpen })),
}));
jest.mock('@/ui/modals/LibreOfficeNoticeModal', () => ({
  LibreOfficeNoticeModal: jest.fn().mockImplementation(() => ({ open: mockNoticeOpen })),
}));
jest.mock('@/ui/modals/InlineEditModal', () => ({
  InlineEditModal: jest.fn(),
  cancelActiveInlineEdit: jest.fn(),
}));

import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';

import { StorageService } from '@/core/storage';
import ObsidianCopilotPlugin from '@/main';

const REMOVED_PDF = {
  '.agents/skills': { pdf: { version: '2c5958ec', state: 'removed' } },
};

function diskVault(base: string) {
  const abs = (p: string) => path.join(base, p);
  const adapter = {
    getBasePath: () => base,
    exists: async (p: string) => fsSync.existsSync(abs(p)),
    read: async (p: string) => fsSync.readFileSync(abs(p), 'utf8'),
    write: async (p: string, c: string) => { fsSync.mkdirSync(path.dirname(abs(p)), { recursive: true }); fsSync.writeFileSync(abs(p), c); },
    mkdir: async (p: string) => { fsSync.mkdirSync(abs(p), { recursive: true }); },
    remove: async (p: string) => { fsSync.rmSync(abs(p)); },
    rename: async (a: string, b: string) => { fsSync.renameSync(abs(a), abs(b)); },
    stat: async (p: string) => (fsSync.existsSync(abs(p)) ? { size: fsSync.statSync(abs(p)).size, type: 'file' } : null),
    list: async () => ({ files: [], folders: [] }),
  };
  return {
    workspace: { getLeavesOfType: jest.fn().mockReturnValue([]) },
    vault: { adapter, create: jest.fn() },
    loadLocalStorage: () => null,
    saveLocalStorage: () => undefined,
  };
}

describe('bundled skill records in data.json', () => {
  it('survive saveSettings (a provider switch in the chat popover)', async () => {
    const base = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bundled-state-'));
    fsSync.mkdirSync(path.join(base, '.ai-tutor'));
    fsSync.writeFileSync(path.join(base, '.ai-tutor/settings.json'), JSON.stringify({ selectedProvider: 'codex' }));

    let stored: Record<string, unknown> = {
      activeConversationId: null,
      skillsAutoInstalled: { claude: true },
      bundledSkills: REMOVED_PDF,
      studyGoalBindings: [{ id: 'b1', briefPath: 'a.md', folderPath: 'a', contextPath: 'a/c.md' }],
    };
    const plugin = new ObsidianCopilotPlugin(diskVault(base) as never, { id: 'obsidian-ai-tutor', version: '0.1.52' } as never);
    plugin.loadData = jest.fn(async () => ({ ...stored }));
    plugin.saveData = jest.fn(async (data: Record<string, unknown>) => { stored = { ...data }; });

    await plugin.loadSettings();
    await plugin.saveSettings();

    expect(stored.skillsAutoInstalled).toEqual({ claude: true });
    expect(stored.bundledSkills).toEqual(REMOVED_PDF);
    expect(stored.studyGoalBindings).toHaveLength(1);
  });

  it('are read back by loadState', async () => {
    const plugin = { app: {}, loadData: jest.fn(async () => ({ bundledSkills: REMOVED_PDF })), saveData: jest.fn() };
    const state = await new StorageService(plugin as never).loadState();
    expect(state.bundledSkills).toEqual(REMOVED_PDF);
  });

  it('survive the legacy migration rewrite of data.json', async () => {
    let stored: Record<string, unknown> = {};
    const plugin = {
      app: { vault: { adapter: { exists: async () => false, mkdir: async () => undefined, write: async () => undefined, read: async () => '{}' } } },
      loadData: jest.fn(async () => ({ ...stored })),
      saveData: jest.fn(async (data: Record<string, unknown>) => { stored = { ...data }; }),
    };
    const storage = new StorageService(plugin as never);
    const ok = await storage.runMigration({ bundledSkills: REMOVED_PDF } as never, { migrateSettings: false });
    expect(ok).toBe(true);
    expect(stored.bundledSkills).toEqual(REMOVED_PDF);
  });

  it('keep the other machine state keys data.json holds through an update', async () => {
    let stored: Record<string, unknown> = { activeConversationId: null, lastEnvHash: 'h1', migrationVersion: 2 };
    const plugin = { app: {}, loadData: jest.fn(async () => ({ ...stored })), saveData: jest.fn(async (d: Record<string, unknown>) => { stored = { ...d }; }) };
    await new StorageService(plugin as never).updateState({ activeConversationId: 'c1' });
    expect(stored).toEqual({ activeConversationId: 'c1', lastEnvHash: 'h1', migrationVersion: 2 });
  });

  it('are not rolled back by a migration that read data.json earlier', async () => {
    const NEWER = { '.claude/skills': { pdf: { version: '2c5958ec', state: 'installed' } } };
    let stored: Record<string, unknown> = { bundledSkills: NEWER, activeConversationId: 'c2' };
    const plugin = {
      app: { vault: { adapter: { exists: async () => false, mkdir: async () => undefined, write: async () => undefined, read: async () => '{}' } } },
      loadData: jest.fn(async () => ({ ...stored })),
      saveData: jest.fn(async (d: Record<string, unknown>) => { stored = { ...d }; }),
    };
    const stale = { bundledSkills: REMOVED_PDF, activeConversationId: 'c1', someOldSetting: true };
    await new StorageService(plugin as never).runMigration(stale as never, { migrateSettings: false });
    expect(stored.bundledSkills).toEqual(NEWER);
    expect(stored.activeConversationId).toBe('c2');
  });

  it('are not overwritten with defaults when data.json cannot be read', async () => {
    const plugin = { app: {}, loadData: jest.fn(async () => { throw new Error('busy'); }), saveData: jest.fn() };
    await expect(new StorageService(plugin as never).updateState({ activeConversationId: 'c1' })).rejects.toThrow('busy');
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it('are not mistaken for settings that need migrating', () => {
    const plugin = { app: {}, loadData: jest.fn(), saveData: jest.fn() };
    const storage = new StorageService(plugin as never);
    expect(storage.needsMigration({ bundledSkills: REMOVED_PDF } as never)).toBe(false);
  });
});

describe('the plugin entry points (evaluator cycle 2 #7, popup)', () => {
  const makePlugin = () => {
    const base = fsSync.mkdtempSync(path.join(os.tmpdir(), 'bundled-entry-'));
    return new ObsidianCopilotPlugin(diskVault(base) as never, { id: 'obsidian-ai-tutor', version: '0.1.52', dir: '.obsidian/plugins/obsidian-ai-tutor' } as never);
  };

  it('shares one archive source between roots that start at the same time', async () => {
    const plugin = makePlugin() as unknown as { getDocArchiveSource: (v: string) => Promise<unknown> };
    const [a, b] = await Promise.all([plugin.getDocArchiveSource('/v'), plugin.getDocArchiveSource('/v')]);
    expect(a).toBe(b);
  });

  it('shows the download-failure notice at most once a day, across restarts', () => {
    const store = new Map<string, unknown>();
    const withStore = () => {
      const plugin = makePlugin();
      (plugin.app as unknown as { loadLocalStorage: (k: string) => unknown }).loadLocalStorage = (k) => store.get(k) ?? null;
      (plugin.app as unknown as { saveLocalStorage: (k: string, v: unknown) => void }).saveLocalStorage = (k, v) => { store.set(k, v); };
      return plugin as unknown as { docDownloadNoticeDue: (now: number) => boolean };
    };
    const day = 24 * 60 * 60 * 1000;
    expect(withStore().docDownloadNoticeDue(10 * day)).toBe(true);
    expect(withStore().docDownloadNoticeDue(10 * day + 60_000)).toBe(false);
    expect(withStore().docDownloadNoticeDue(11 * day + 1)).toBe(true);
  });

  it('shows an install failure on the Settings line instead of only the console', async () => {
    const plugin = makePlugin() as unknown as {
      getDocArchiveSource: () => Promise<never>;
      ensureBundledSkills: (p: string) => Promise<void>;
      bundledSkillProblems: Map<string, string[]>;
      loadSettings: () => Promise<void>;
      loadData: () => Promise<unknown>;
      saveData: (d: unknown) => Promise<void>;
    };
    plugin.loadData = async () => ({});
    plugin.saveData = async () => undefined;
    await plugin.loadSettings();
    const adapter = (plugin as unknown as { app: { vault: { adapter: Record<string, unknown> } } }).app.vault.adapter;
    adapter.basePath = (adapter.getBasePath as () => string)();
    plugin.getDocArchiveSource = async () => { throw new Error('module not found'); };
    await plugin.ensureBundledSkills('claude');
    expect(plugin.bundledSkillProblems.get('.claude/skills')?.join(' ')).toMatch(/module not found/);
  });

  it('tells a student switching to agy about web search in a popup, once', async () => {
    const plugin = makePlugin();
    const store = new Map<string, unknown>();
    (plugin.app as unknown as { loadLocalStorage: (k: string) => unknown }).loadLocalStorage = (k) => store.get(k) ?? null;
    (plugin.app as unknown as { saveLocalStorage: (k: string, v: unknown) => void }).saveLocalStorage = (k, v) => { store.set(k, v); };
    let stored: Record<string, unknown> = {};
    plugin.loadData = jest.fn(async () => ({ ...stored }));
    plugin.saveData = jest.fn(async (d: Record<string, unknown>) => { stored = { ...d }; });
    plugin.ensureBundledSkills = jest.fn(async () => undefined);
    await plugin.loadSettings();
    (plugin as unknown as { lastEnsuredProvider: string }).lastEnsuredProvider = 'claude';
    plugin.settings.selectedProvider = 'codex';
    await plugin.saveSettings();
    expect(mockAgyOpen).not.toHaveBeenCalled();
    plugin.settings.selectedProvider = 'agy';
    await plugin.saveSettings();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockAgyOpen).toHaveBeenCalledTimes(1);
    (plugin as unknown as { lastEnsuredProvider: string }).lastEnsuredProvider = 'claude';
    await plugin.saveSettings();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockAgyOpen).toHaveBeenCalledTimes(1);
  });

  it('opens the LibreOffice popup once when two roots finish installing together', async () => {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return;
    const plugin = makePlugin();
    const store = new Map<string, string>();
    (plugin.app as unknown as { loadLocalStorage: (k: string) => string | null }).loadLocalStorage = (k) => store.get(k) ?? null;
    (plugin.app as unknown as { saveLocalStorage: (k: string, v: string) => void }).saveLocalStorage = (k, v) => { store.set(k, v); };
    plugin.findLibreOffice = async () => null;
    await Promise.all([plugin.maybeShowLibreOfficeNotice(), plugin.maybeShowLibreOfficeNotice()]);
    expect(mockNoticeOpen).toHaveBeenCalledTimes(1);
  });
});

