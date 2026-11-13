import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parseDocArchive } from '@/features/skills/BundledSkills';
import { archiveUrl, createArchiveSource, DOC_ARCHIVE } from '@/features/skills/docSkillsArchive';

const ASSET = path.join(__dirname, '../../../../assets', DOC_ARCHIVE.file);
const PIN = { ...DOC_ARCHIVE, commit: 'a'.repeat(40) };

describe('the committed archive', () => {
  it('matches the hash compiled into the plugin and holds the four skills', () => {
    const gz = fs.readFileSync(ASSET);
    expect(createHash('sha256').update(gz).digest('hex')).toBe(DOC_ARCHIVE.sha256);
    const archive = parseDocArchive(gz, DOC_ARCHIVE.sha256);
    expect(Object.keys(archive.skills).sort()).toEqual(['docx', 'pdf', 'pptx', 'xlsx']);
    expect(Object.keys(archive.skills.docx)).toHaveLength(61);
    for (const name of ['pdf', 'xlsx', 'docx', 'pptx']) {
      expect(archive.skills[name]['LICENSE.txt'].toString()).toContain('Apache License');
    }
  });
});

describe('archiveUrl', () => {
  it('ships with the commit that holds the archive pinned (a release without it downloads nothing)', () => {
    expect(archiveUrl()).toBe(`https://raw.githubusercontent.com/leeht1107/obsidian-ai-tutor/6ab194f3aef0a8ee501c827700646165a97ea22d/assets/${DOC_ARCHIVE.file}`);
  });
  it('downloads nothing until the archive commit is pinned', () => {
    expect(archiveUrl({ ...DOC_ARCHIVE, commit: '' })).toBeNull();
  });
  it('uses the immutable commit URL', () => {
    expect(archiveUrl(PIN)).toBe(`https://raw.githubusercontent.com/leeht1107/obsidian-ai-tutor/${'a'.repeat(40)}/assets/${DOC_ARCHIVE.file}`);
  });
});

describe('createArchiveSource', () => {
  let dir: string;
  const good = () => fs.readFileSync(ASSET);
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-')); });
  const base = { sleep: async () => undefined, random: () => 0.5, pin: PIN };

  it('downloads once for many callers and caches the verified bytes', async () => {
    const fetchBytes = jest.fn(async () => good());
    const source = createArchiveSource({ ...base, cacheDir: dir, fetchBytes });
    const results = await Promise.all([source.get(), source.get(), source.get(), source.get()]);
    expect(results.every((r) => r !== null)).toBe(true);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    const fresh = createArchiveSource({ ...base, cacheDir: dir, fetchBytes: jest.fn(async () => null) });
    expect(await fresh.get()).not.toBeNull(); // offline, from cache
  });

  it('writes no cache from a tampered download and backs off', async () => {
    let t = 0;
    const tampered = Buffer.concat([good(), Buffer.from('x')]);
    const fetchBytes = jest.fn(async () => tampered);
    const source = createArchiveSource({ ...base, cacheDir: dir, fetchBytes, now: () => t });
    expect(await source.get()).toBeNull();
    expect(fs.existsSync(path.join(dir, DOC_ARCHIVE.file))).toBe(false);
    t += 10 * 60 * 1000; // ten minutes later: still waiting
    expect(await source.get()).toBeNull();
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    t += 2 * 60 * 60 * 1000;
    await source.get();
    expect(fetchBytes).toHaveBeenCalledTimes(2);
    expect(source.failures()).toBe(2);
  });

  it('leaves no temp file when the cache cannot be renamed into place', async () => {
    const spy = jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk full'); });
    try {
      const source = createArchiveSource({ ...base, cacheDir: dir, fetchBytes: async () => good() });
      expect(await source.get()).toBeNull();
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps waiting after a restart instead of retrying at once', async () => {
    let saved: { failures: number; nextTryAt: number } | null = null;
    const retry = { load: () => saved, save: (v: { failures: number; nextTryAt: number }) => { saved = v; } };
    const fetchBytes = jest.fn(async () => null);
    const t = 1_000_000;
    const first = createArchiveSource({ ...base, cacheDir: dir, fetchBytes, now: () => t, retry });
    expect(await first.get()).toBeNull();
    expect(saved).not.toBeNull();
    const afterRestart = createArchiveSource({ ...base, cacheDir: dir, fetchBytes, now: () => t + 60_000, retry });
    expect(await afterRestart.get()).toBeNull();
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(afterRestart.failures()).toBe(1);
  });

  it('treats a network error as pending, not as installed', async () => {
    const source = createArchiveSource({ ...base, cacheDir: dir, fetchBytes: async () => { throw new Error('offline'); } });
    expect(await source.get()).toBeNull();
  });

  it('waits a random time before the first download', async () => {
    const sleep = jest.fn(async () => undefined);
    const source = createArchiveSource({ ...base, sleep, random: () => 0.25, startJitterMs: 30_000, cacheDir: dir, fetchBytes: async () => good() });
    await source.get();
    expect(sleep).toHaveBeenCalledWith(7500);
  });
});
