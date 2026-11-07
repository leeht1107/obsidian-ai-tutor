import * as fsSync from 'fs';
import type { App } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { nodeExclusiveCreate, ObsidianRecordFs } from '@/core/storage/LearningRecordFs';

function fakeApp() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const create = jest.fn(async (path: string, content: string) => {
    if (files.has(path)) throw new Error('File already exists.');
    files.set(path, content);
  });
  const adapter = {
    exists: async (p: string) => files.has(p) || folders.has(p),
    read: async (p: string) => files.get(p) as string,
    write: jest.fn(async (p: string, c: string) => { files.set(p, c); }),
    mkdir: jest.fn(async (p: string) => { folders.add(p); }),
    list: async (folder: string) => ({
      files: [...files.keys()].filter((f) => f.startsWith(`${folder}/`) && !f.slice(folder.length + 1).includes('/')),
      folders: [...folders].filter((f) => f.startsWith(`${folder}/`)),
    }),
    stat: async (p: string) => (files.has(p) ? { size: (files.get(p) as string).length } : null),
  };
  const app = { vault: { adapter, create } } as unknown as App;
  return { app, files, folders, adapter, create };
}

describe('ObsidianRecordFs.createOnly', () => {
  it('creates missing folders and a hidden-folder note without the overwriting adapter write', async () => {
    const { app, abs, adapter } = diskApp();
    const vaultCreate = (app.vault as unknown as { create: jest.Mock }).create;
    await new ObsidianRecordFs(app).createOnly('.ai-tutor/learning-records/a.md', 'body');
    expect(fsSync.readFileSync(abs('.ai-tutor/learning-records/a.md'), 'utf8')).toBe('body');
    expect(adapter.write).not.toHaveBeenCalled();
    expect(vaultCreate).not.toHaveBeenCalled();
  });

  it('creates a visible-folder note on real disk with the exclusive primitive, not the overwriting or index create', async () => {
    const { app, abs, adapter } = diskApp();
    await new ObsidianRecordFs(app).createOnly('학습 기록/a.md', 'body');
    expect(fsSync.readFileSync(abs('학습 기록/a.md'), 'utf8')).toBe('body');
    expect(adapter.write).not.toHaveBeenCalled();
    expect((app.vault as unknown as { create: jest.Mock }).create).not.toHaveBeenCalled();
  });

  it.each(['.ai-tutor/learning-records/a.md', '학습 기록/a.md'])('never overwrites an existing file (%s)', async (path) => {
    const { app, files } = fakeApp();
    files.set(path, 'original');
    await expect(new ObsidianRecordFs(app).createOnly(path, 'new')).rejects.toThrow();
    expect(files.get(path)).toBe('original');
  });

  it('lists a hidden folder through the adapter listing', async () => {
    const { app, files } = fakeApp();
    files.set('.ai-tutor/learning-records/a.md', 'x');
    const listing = await new ObsidianRecordFs(app).list('.ai-tutor/learning-records');
    expect(listing.files).toEqual(['.ai-tutor/learning-records/a.md']);
  });
});

/** A vault whose hidden folder is real disk, the way FileSystemAdapter backs it on desktop. */
function diskApp(options: { withBasePath?: boolean } = {}) {
  const base = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lrfs-'));
  const abs = (p: string) => path.join(base, p);
  const adapter: Record<string, unknown> = {
    exists: async (p: string) => fsSync.existsSync(abs(p)),
    read: async (p: string) => fsSync.readFileSync(abs(p), 'utf8'),
    // Same semantics as the Obsidian adapter: a plain overwriting write.
    write: jest.fn(async (p: string, c: string) => { fsSync.writeFileSync(abs(p), c); }),
    mkdir: async (p: string) => { fsSync.mkdirSync(abs(p), { recursive: true }); },
    list: async () => ({ files: [], folders: [] }),
    stat: async () => null,
  };
  if (options.withBasePath !== false) adapter.getBasePath = () => base;
  const app = { vault: { adapter, create: jest.fn() } } as unknown as App;
  return { app, base, abs, adapter };
}

describe('ObsidianRecordFs.createOnly exclusive hidden create', () => {
  const target = '.ai-tutor/learning-records/a.md';

  it('keeps the other writer\'s exact bytes when the file appears between the last check and the write', async () => {
    const { app, abs, adapter } = diskApp();
    const other = 'OTHER WRITER \u00e9\n';
    let raced = false;
    const otherWriterWins = () => {
      raced = true;
      fsSync.mkdirSync(path.dirname(abs(target)), { recursive: true });
      fsSync.writeFileSync(abs(target), other);
    };
    // The window under test is "checked absent, then written": the other writer lands in it,
    // whichever primitive does the write (the plain adapter write or the exclusive create).
    const plainWrite = adapter.write as jest.Mock;
    plainWrite.mockImplementation(async (p: string, c: string) => { otherWriterWins(); fsSync.writeFileSync(abs(p), c); });
    const exclusive = {
      createExclusive: async (file: string, content: string) => { otherWriterWins(); await nodeExclusiveCreate.createExclusive(file, content); },
    };
    await expect(new ObsidianRecordFs(app, exclusive).createOnly(target, 'mine')).rejects.toThrow(/already exists/);
    expect(raced).toBe(true);
    expect(fsSync.readFileSync(abs(target), 'utf8')).toBe(other);
  });

  it('never overwrites a file that appeared after the folder step even if exists() lies', async () => {
    const { app, abs, adapter } = diskApp();
    fsSync.mkdirSync(path.dirname(abs(target)), { recursive: true });
    fsSync.writeFileSync(abs(target), 'original');
    (adapter as { exists: unknown }).exists = async (p: string) => p !== target && fsSync.existsSync(abs(p));
    await expect(new ObsidianRecordFs(app).createOnly(target, 'mine')).rejects.toThrow();
    expect(fsSync.readFileSync(abs(target), 'utf8')).toBe('original');
  });

  it('writes the exact bytes into a newly created hidden folder', async () => {
    const { app, abs } = diskApp();
    await new ObsidianRecordFs(app).createOnly(target, '---\nx\n---\n한글\n');
    expect(fsSync.readFileSync(abs(target), 'utf8')).toBe('---\nx\n---\n한글\n');
  });

  it('fails safely when the backing adapter has no physical base path', async () => {
    const { app, adapter } = diskApp({ withBasePath: false });
    await expect(new ObsidianRecordFs(app).createOnly(target, 'mine')).rejects.toThrow(/unsupported/i);
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it('refuses a parent folder that is a symlink leaving the vault', async () => {
    const { app, base } = diskApp();
    const outside = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lrfs-out-'));
    fsSync.symlinkSync(outside, path.join(base, '.ai-tutor'));
    await expect(new ObsidianRecordFs(app).createOnly(target, 'mine')).rejects.toThrow(/outside the vault/i);
    expect(fsSync.readdirSync(outside)).toEqual([]);
  });

  it('refuses traversal segments', async () => {
    const { app } = diskApp();
    await expect(new ObsidianRecordFs(app).createOnly('.ai-tutor/../../escape.md', 'x')).rejects.toThrow();
  });

  it('leaves a partially written file in place so reconciliation sees it, never deleting it', async () => {
    const { app, abs } = diskApp();
    const failing = {
      createExclusive: async (file: string) => {
        fsSync.writeFileSync(file, 'par');
        throw new Error('disk full');
      },
    };
    await expect(new ObsidianRecordFs(app, failing).createOnly(target, 'partial-content')).rejects.toThrow('disk full');
    expect(fsSync.readFileSync(abs(target), 'utf8')).toBe('par');
  });
});

describe.each([
  ['hidden', '.ai-tutor/learning-records', '.link'],
  ['visible', '학습 기록', 'link'],
])('ObsidianRecordFs.createOnly physical containment (%s configured folder)', (_label, folder, linkName) => {
  const file = `${folder}/a.md`;
  const outsideDir = () => fsSync.mkdtempSync(path.join(os.tmpdir(), 'lrfs-out-'));

  it('creates inside the vault', async () => {
    const { app, abs } = diskApp();
    await new ObsidianRecordFs(app).createOnly(file, 'body');
    expect(fsSync.readFileSync(abs(file), 'utf8')).toBe('body');
  });

  it('creates no directory or file outside through a symlinked first folder (nested parent)', async () => {
    const { app, base } = diskApp();
    const outside = outsideDir();
    fsSync.symlinkSync(outside, path.join(base, linkName));
    await expect(new ObsidianRecordFs(app).createOnly(`${linkName}/sub/record.md`, 'x')).rejects.toThrow(/outside the vault/i);
    expect(fsSync.readdirSync(outside)).toEqual([]);
  });

  it('creates nothing outside when the final folder is an existing symlink', async () => {
    const { app, base, abs } = diskApp();
    const outside = outsideDir();
    fsSync.mkdirSync(abs(folder), { recursive: true });
    fsSync.rmSync(abs(folder), { recursive: true });
    fsSync.mkdirSync(path.dirname(abs(folder)), { recursive: true });
    fsSync.symlinkSync(outside, abs(folder));
    await expect(new ObsidianRecordFs(app).createOnly(file, 'x')).rejects.toThrow(/outside the vault/i);
    expect(fsSync.readdirSync(outside)).toEqual([]);
    expect(base).toBeTruthy();
  });

  it('keeps an externally created target intact when it appears after the last check', async () => {
    const { app, abs } = diskApp();
    const exclusive = {
      createExclusive: async (target: string, content: string) => {
        fsSync.writeFileSync(abs(file), 'EXTERNAL');
        await nodeExclusiveCreate.createExclusive(target, content);
      },
    };
    await expect(new ObsidianRecordFs(app, exclusive).createOnly(file, 'mine')).rejects.toThrow(/already exists/);
    expect(fsSync.readFileSync(abs(file), 'utf8')).toBe('EXTERNAL');
  });

  it('refuses before creating any folder when the adapter has no physical base path', async () => {
    const { app, base } = diskApp({ withBasePath: false });
    await expect(new ObsidianRecordFs(app).createOnly(file, 'x')).rejects.toThrow(/unsupported/i);
    expect(fsSync.readdirSync(base)).toEqual([]);
  });
});

describe('ObsidianRecordFs.createOnly concurrent parent replacement', () => {
  const target = '.ai-tutor/learning-records/a.md';

  /** Swap `dir` for a symlink to `outside` the first time realpath resolves it, like a concurrent process would. */
  function swapOnFirstResolve(dir: string, outside: string) {
    const original = fsSync.promises.realpath;
    let swapped = false;
    const spy = jest.spyOn(fsSync.promises, 'realpath').mockImplementation((async (p: fsSync.PathLike, ...rest: unknown[]) => {
      const value = await (original as (...a: unknown[]) => Promise<string>).call(fsSync.promises, p, ...rest);
      if (!swapped && p === dir) {
        swapped = true;
        fsSync.renameSync(dir, `${dir}-original`);
        fsSync.symlinkSync(outside, dir);
      }
      return value;
    }) as typeof fsSync.promises.realpath);
    return { spy, wasSwapped: () => swapped };
  }

  afterEach(() => jest.restoreAllMocks());

  it('creates nothing outside the vault when the parent is replaced by a symlink after its containment check', async () => {
    const { app, abs } = diskApp();
    const outside = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lrfs-outside-'));
    fsSync.mkdirSync(path.dirname(abs(target)), { recursive: true });
    const probe = swapOnFirstResolve(path.dirname(abs(target)), outside);
    await expect(new ObsidianRecordFs(app).createOnly(target, 'mine')).rejects.toThrow(/outside the vault/);
    expect(probe.wasSwapped()).toBe(true);
    expect(fsSync.readdirSync(outside)).toEqual([]);
  });

  it('rejects the swapped parent before the exclusive create is ever called', async () => {
    const { app, abs } = diskApp();
    const outside = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lrfs-outside-'));
    fsSync.mkdirSync(path.dirname(abs(target)), { recursive: true });
    swapOnFirstResolve(path.dirname(abs(target)), outside);
    const exclusive = { createExclusive: jest.fn(nodeExclusiveCreate.createExclusive) };
    await expect(new ObsidianRecordFs(app, exclusive).createOnly(target, 'mine')).rejects.toThrow(/outside the vault/);
    expect(exclusive.createExclusive).not.toHaveBeenCalled();
    expect(fsSync.readdirSync(outside)).toEqual([]);
  });

  it('never deletes an unrelated outside file when our created file is renamed away and its path becomes a symlink to it', async () => {
    const { app, abs } = diskApp();
    const outside = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lrfs-outside-'));
    const victim = path.join(outside, 'victim.md');
    fsSync.writeFileSync(victim, 'valuable');
    fsSync.mkdirSync(path.dirname(abs(target)), { recursive: true });
    const hostile = {
      createExclusive: async (file: string, content: string) => {
        await nodeExclusiveCreate.createExclusive(file, content);
        fsSync.renameSync(file, `${file}.ours`);
        fsSync.symlinkSync(victim, file);
      },
    };
    await new ObsidianRecordFs(app, hostile).createOnly(target, 'our record').catch(() => undefined);
    expect(fsSync.readFileSync(victim, 'utf8')).toBe('valuable');
    expect(fsSync.readFileSync(`${abs(target)}.ours`, 'utf8')).toBe('our record');
  });

  it('reports a folder the vault adapter made outside the vault because the parent was replaced before mkdir', async () => {
    const { app, abs, adapter } = diskApp();
    const outside = fsSync.mkdtempSync(path.join(os.tmpdir(), 'lrfs-outside-'));
    fsSync.mkdirSync(abs('.ai-tutor'), { recursive: true });
    const realMkdir = adapter.mkdir as (p: string) => Promise<void>;
    adapter.mkdir = async (p: string) => {
      if (p === '.ai-tutor/learning-records') {
        fsSync.renameSync(abs('.ai-tutor'), abs('.ai-tutor-original'));
        fsSync.symlinkSync(outside, abs('.ai-tutor'));
      }
      await realMkdir(p);
    };
    await expect(new ObsidianRecordFs(app).createOnly(target, 'mine')).rejects.toThrow(/outside the vault/);
    expect(fsSync.existsSync(path.join(outside, 'a.md'))).toBe(false);
  });
});
