/**
 * BRAT-only upgrade: a student whose saved settings predate learning records gets the default
 * record folder and a working in-process save, with no official Obsidian CLI and no terminal.
 */
jest.mock('@/ui/modals/InlineEditModal', () => ({
  InlineEditModal: jest.fn(),
  cancelActiveInlineEdit: jest.fn(),
}));
jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    spawn: jest.fn(() => { throw new Error('no process may be spawned'); }),
    spawnSync: jest.fn(() => { throw new Error('no process may be spawned'); }),
    exec: jest.fn(() => { throw new Error('no process may be spawned'); }),
    execFile: jest.fn(() => { throw new Error('no process may be spawned'); }),
    execSync: jest.fn(() => { throw new Error('no process may be spawned'); }),
    execFileSync: jest.fn(() => { throw new Error('no process may be spawned'); }),
  };
});

import * as childProcess from 'child_process';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';

import { type CompletedLearningSnapshot,discoverRecords } from '@/core/learning/records';
import { ObsidianRecordFs } from '@/core/storage/LearningRecordFs';
import ObsidianCopilotPlugin from '@/main';

const DEFAULT_FOLDER = '.ai-tutor/learning-records';

/** A desktop-style vault on a real directory, as FileSystemAdapter exposes it. */
function diskVault(base: string) {
  const abs = (p: string) => path.join(base, p);
  const adapter = {
    getBasePath: () => base,
    exists: async (p: string) => fsSync.existsSync(abs(p)),
    read: async (p: string) => fsSync.readFileSync(abs(p), 'utf8'),
    write: async (p: string, c: string) => { fsSync.writeFileSync(abs(p), c); },
    mkdir: async (p: string) => { fsSync.mkdirSync(abs(p), { recursive: true }); },
    remove: async (p: string) => { fsSync.rmSync(abs(p)); },
    rename: async (a: string, b: string) => { fsSync.renameSync(abs(a), abs(b)); },
    stat: async (p: string) => (fsSync.existsSync(abs(p)) ? { size: fsSync.statSync(abs(p)).size, type: 'file' } : null),
    list: async (folder: string) => {
      const dir = abs(folder);
      if (!fsSync.existsSync(dir)) return { files: [], folders: [] };
      const entries = fsSync.readdirSync(dir, { withFileTypes: true });
      return {
        files: entries.filter((e) => e.isFile()).map((e) => `${folder}/${e.name}`),
        folders: entries.filter((e) => e.isDirectory()).map((e) => `${folder}/${e.name}`),
      };
    },
  };
  return {
    workspace: { getLeavesOfType: jest.fn().mockReturnValue([]) },
    vault: { adapter, create: jest.fn() },
    loadLocalStorage: () => null,
    saveLocalStorage: () => undefined,
  };
}

const SNAPSHOT: CompletedLearningSnapshot = {
  version: 1, conversationId: 'conv-1', completionMessageId: 'a2', mode: 'socratic', origin: 'socratic',
  learningSessionId: 'u1', completedAt: 1, sourcePaths: [], scopeLabel: '/socratic', questions: [],
  summaryMessageId: 'a2', reportOrigin: 'ai-draft',
};

describe('existing student upgrading through BRAT', () => {
  let base: string;
  beforeEach(() => {
    base = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lr-upgrade-'));
    fsSync.mkdirSync(path.join(base, '.ai-tutor'));
    // Settings written by a release that had no learningRecordsFolder.
    fsSync.writeFileSync(path.join(base, '.ai-tutor/settings.json'), JSON.stringify({ userName: '학생', model: 'gpt-4.1' }));
  });

  it('gets the default record folder from the old settings file and can save and list records in-process', async () => {
    const plugin = new ObsidianCopilotPlugin(diskVault(base) as never, { id: 'obsidian-ai-tutor', version: '0.1.49' } as never);
    plugin.loadData = jest.fn().mockResolvedValue(null);
    plugin.saveData = jest.fn().mockResolvedValue(undefined);

    const stored = JSON.parse(fsSync.readFileSync(path.join(base, '.ai-tutor/settings.json'), 'utf8'));
    expect(stored).not.toHaveProperty('learningRecordsFolder');

    await plugin.loadSettings();
    expect(plugin.settings.learningRecordsFolder).toBe(DEFAULT_FOLDER);
    expect(plugin.settings.userName).toBe('학생'); // old values are kept

    // The same path the save modal uses: create-only, hidden folder, no CLI.
    const service = plugin.getLearningRecordSaveService();
    plugin.getLearningSnapshot = () => SNAPSHOT;
    plugin.commitLearningSnapshot = jest.fn().mockResolvedValue(true) as never;
    const markdown = '---\ntype: ai-tutor-learning-record\nformatVersion: 1\nrecordId: "lr-up"\nmode: socratic\nsourcePaths: []\n---\n\n# 학습 기록\n';
    const outcome = await service.save({
      conversationId: 'conv-1', completionMessageId: 'a2', folder: plugin.settings.learningRecordsFolder,
      fileName: '업그레이드 확인', markdown, previewRevision: 1,
    });
    expect(outcome).toMatchObject({ kind: 'saved', path: `${DEFAULT_FOLDER}/업그레이드 확인.md` });
    expect(fsSync.readFileSync(path.join(base, DEFAULT_FOLDER, '업그레이드 확인.md'), 'utf8')).toBe(markdown);

    const { records } = await discoverRecords(new ObsidianRecordFs(plugin.app), plugin.settings.learningRecordsFolder);
    expect(records.map((r) => r.recordId)).toEqual(['lr-up']);

    for (const fn of [childProcess.spawn, childProcess.spawnSync, childProcess.exec, childProcess.execFile, childProcess.execSync, childProcess.execFileSync]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('repairs an unusable stored folder value instead of failing every later save', async () => {
    fsSync.writeFileSync(path.join(base, '.ai-tutor/settings.json'), JSON.stringify({ learningRecordsFolder: '../outside' }));
    const plugin = new ObsidianCopilotPlugin(diskVault(base) as never, { id: 'obsidian-ai-tutor', version: '0.1.49' } as never);
    plugin.loadData = jest.fn().mockResolvedValue(null);
    await plugin.loadSettings();
    expect(plugin.settings.learningRecordsFolder).toBe(DEFAULT_FOLDER);
  });
});
