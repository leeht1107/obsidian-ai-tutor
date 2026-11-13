/**
 * The automatic install of the six bundled skills, on a real temp folder.
 * What a student must be able to rely on: everything appears once, a delete
 * stays a delete, their own folders are never touched, and nothing is written
 * when the archive cannot be trusted or reached.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gzipSync } from 'zlib';

import {
  autoSkillsRoot,
  DOC_SKILL_MARKER,
  type DocArchive,
  type EnsureInput,
  ensureRoot,
  parseDocArchive,
} from '@/features/skills/BundledSkills';

const BODIES = { 'obsidian-markdown': '---\nname: obsidian-markdown\n---\nmd', 'json-canvas': '---\nname: json-canvas\n---\ncanvas' };

function skillFiles(name: string, extra = ''): Record<string, string> {
  return {
    'SKILL.md': `---\nname: ${name}\n---\n${name} ${extra}`,
    'LICENSE.txt': 'Apache-2.0',
    'scripts/run.py': `print("${name}${extra}")`,
  };
}

function makeArchive(version = 'v1', mutate?: (raw: Record<string, unknown>) => void): { gz: Buffer; sha: string } {
  const skills: Record<string, Record<string, string>> = {};
  for (const name of ['pdf', 'xlsx', 'docx', 'pptx']) {
    skills[name] = Object.fromEntries(Object.entries(skillFiles(name, version)).map(([k, v]) => [k, Buffer.from(v).toString('base64')]));
  }
  const raw: Record<string, unknown> = { version, skills, executables: { pdf: ['scripts/run.py'], xlsx: [], docx: [], pptx: [] } };
  mutate?.(raw);
  let text = JSON.stringify(raw);
  if (raw.__dupe) text = text.replace('"__dupe":true', '"version":"v1","version":"v2"');
  const gz = gzipSync(Buffer.from(text));
  return { gz, sha: createHash('sha256').update(gz).digest('hex') };
}

function archive(version = 'v1'): DocArchive {
  const { gz, sha } = makeArchive(version);
  return parseDocArchive(gz, sha);
}

let vault: string;
beforeEach(() => { vault = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-')); });

function input(over: Partial<EnsureInput> = {}): EnsureInput {
  return {
    vaultPath: vault,
    root: '.agents/skills',
    records: {},
    markdownBodies: BODIES,
    evidence: { legacyUser: false },
    getArchive: async () => archive(),
    ...over,
  };
}

const has = (root: string, name: string) => fs.existsSync(path.join(vault, root, name));

describe('autoSkillsRoot', () => {
  it('uses the folder each CLI was observed to read', () => {
    expect(autoSkillsRoot('claude')).toBe('.claude/skills');
    expect(autoSkillsRoot('codex')).toBe('.agents/skills');
    expect(autoSkillsRoot('copilot')).toBe('.agents/skills');
    expect(autoSkillsRoot('agy')).toBe('.agents/skills');
  });
});

describe('ensureRoot', () => {
  it('installs all six skills on a fresh vault', async () => {
    const result = await ensureRoot(input());
    for (const name of ['obsidian-markdown', 'json-canvas', 'pdf', 'xlsx', 'docx', 'pptx']) {
      expect(has('.agents/skills', name)).toBe(true);
      expect(result.records[name].state).toBe('installed');
    }
    expect(fs.readFileSync(path.join(vault, '.agents/skills/pdf/scripts/run.py'), 'utf8')).toBe('print("pdfv1")');
    expect(fs.existsSync(path.join(vault, '.agents/skills/pdf', DOC_SKILL_MARKER))).toBe(true);
  });

  it('keeps upstream executable bits', async () => {
    await ensureRoot(input());
    if (process.platform === 'win32') return;
    expect(fs.statSync(path.join(vault, '.agents/skills/pdf/scripts/run.py')).mode & 0o111).not.toBe(0);
  });

  it('turns a deleted skill into a tombstone and never brings it back', async () => {
    const first = await ensureRoot(input());
    fs.rmSync(path.join(vault, '.agents/skills/pdf'), { recursive: true });
    fs.rmSync(path.join(vault, '.agents/skills/json-canvas'), { recursive: true });
    const second = await ensureRoot(input({ records: first.records }));
    expect(second.records.pdf.state).toBe('removed');
    expect(second.records['json-canvas'].state).toBe('removed');
    const third = await ensureRoot(input({ records: second.records }));
    expect(has('.agents/skills', 'pdf')).toBe(false);
    expect(has('.agents/skills', 'json-canvas')).toBe(false);
    expect(third.installed).toEqual([]);
  });

  it('leaves a student folder of the same name byte for byte', async () => {
    const own = path.join(vault, '.agents/skills/pdf');
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, 'SKILL.md'), 'mine');
    const result = await ensureRoot(input());
    expect(result.records.pdf.state).toBe('kept');
    expect(fs.readdirSync(own)).toEqual(['SKILL.md']);
    expect(fs.readFileSync(path.join(own, 'SKILL.md'), 'utf8')).toBe('mine');
  });

  it('writes no doc skill and no doc record while offline, and installs later', async () => {
    const offline = await ensureRoot(input({ getArchive: async () => null }));
    expect(offline.pending.sort()).toEqual(['docx', 'pdf', 'pptx', 'xlsx']);
    expect(offline.records.pdf).toBeUndefined();
    expect(has('.agents/skills', 'pdf')).toBe(false);
    expect(offline.records['obsidian-markdown'].state).toBe('installed');
    const online = await ensureRoot(input({ records: offline.records }));
    expect(online.records.pdf.state).toBe('installed');
  });

  it('does not take over a staging folder it cannot prove is its own', async () => {
    const foreign = path.join(vault, '.agents/skills/.installing-pdf');
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'notes.md'), 'student');
    const result = await ensureRoot(input());
    expect(result.errors.some((e) => e.startsWith('pdf:'))).toBe(true);
    expect(fs.readFileSync(path.join(foreign, 'notes.md'), 'utf8')).toBe('student');
    expect(has('.agents/skills', 'pdf')).toBe(false);
    expect(result.records.pdf).toBeUndefined();
  });

  it('updates an unmodified copy and keeps an edited one', async () => {
    const first = await ensureRoot(input());
    fs.appendFileSync(path.join(vault, '.agents/skills/docx/SKILL.md'), 'my note');
    const second = await ensureRoot(input({ records: first.records, getArchive: async () => archive('v2') }));
    expect(second.records.pdf).toMatchObject({ version: 'v2', state: 'installed' });
    expect(fs.readFileSync(path.join(vault, '.agents/skills/pdf/scripts/run.py'), 'utf8')).toBe('print("pdfv2")');
    expect(second.records.docx.state).toBe('kept');
    expect(fs.readFileSync(path.join(vault, '.agents/skills/docx/SKILL.md'), 'utf8')).toContain('my note');
  });

  it('keeps a student file added inside a doc skill by not updating that skill', async () => {
    const first = await ensureRoot(input());
    fs.writeFileSync(path.join(vault, '.agents/skills/xlsx/mine.md'), 'x');
    const second = await ensureRoot(input({ records: first.records, getArchive: async () => archive('v2') }));
    expect(second.records.xlsx.state).toBe('kept');
    expect(fs.existsSync(path.join(vault, '.agents/skills/xlsx/mine.md'))).toBe(true);
  });
});

describe('0.1.51 students (D8)', () => {
  it('does not bring back markdown skills when 0.1.51 erased the flag', async () => {
    const result = await ensureRoot(input({ root: '.claude/skills', evidence: { legacyUser: true, skillsAutoInstalled: undefined } }));
    expect(result.records['obsidian-markdown'].state).toBe('removed');
    expect(has('.claude/skills', 'obsidian-markdown')).toBe(false);
    expect(result.records.pdf.state).toBe('installed');
  });

  it('does not carry an old copilot copy into the shared root, which agy may have deleted it from (evaluator cycle 6 #1)', async () => {
    fs.mkdirSync(path.join(vault, '.copilot/skills/obsidian-markdown'), { recursive: true });
    fs.writeFileSync(path.join(vault, '.copilot/skills/obsidian-markdown/SKILL.md'), 'old copy');
    const result = await ensureRoot(input({ evidence: { legacyUser: true, provider: 'copilot', skillsAutoInstalled: undefined } }));
    expect(result.records['obsidian-markdown'].state).toBe('removed');
    expect(has('.agents/skills', 'obsidian-markdown')).toBe(false);
    expect(result.records['json-canvas'].state).toBe('removed');
    expect(fs.readFileSync(path.join(vault, '.copilot/skills/obsidian-markdown/SKILL.md'), 'utf8')).toBe('old copy');
    expect(result.records.pdf.state).toBe('installed');
  });

  it('does not carry an old codex copy into the shared root either', async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    fs.mkdirSync(path.join(codexHome, 'skills/json-canvas'), { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'skills/json-canvas/SKILL.md'), 'old copy');
    const saved = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const result = await ensureRoot(input({ evidence: { legacyUser: true, provider: 'codex' } }));
      expect(result.records['json-canvas'].state).toBe('removed');
      expect(result.records['obsidian-markdown'].state).toBe('removed');
      expect(fs.existsSync(path.join(codexHome, 'skills/json-canvas/SKILL.md'))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
    }
  });

  it('keeps an agy deletion even when an old copilot copy is still around (evaluator cycle 3 #2)', async () => {
    fs.mkdirSync(path.join(vault, '.copilot/skills/obsidian-markdown'), { recursive: true });
    fs.writeFileSync(path.join(vault, '.copilot/skills/obsidian-markdown/SKILL.md'), 'old copy');
    const result = await ensureRoot(input({ evidence: { legacyUser: true, provider: 'agy' } }));
    expect(result.records['obsidian-markdown'].state).toBe('removed');
    expect(has('.agents/skills', 'obsidian-markdown')).toBe(false);
  });

  it('keeps an agy deletion when upgraded with copilot selected and agy had the skill (evaluator cycle 5 #1)', async () => {
    fs.mkdirSync(path.join(vault, '.copilot/skills/obsidian-markdown'), { recursive: true });
    fs.writeFileSync(path.join(vault, '.copilot/skills/obsidian-markdown/SKILL.md'), 'old copy');
    const result = await ensureRoot(input({ evidence: { legacyUser: true, provider: 'copilot', skillsAutoInstalled: { agy: true, copilot: true } } }));
    expect(result.records['obsidian-markdown'].state).toBe('removed');
    expect(has('.agents/skills', 'obsidian-markdown')).toBe(false);
  });

  it('installs markdown skills for a student new to this version', async () => {
    const result = await ensureRoot(input({ evidence: { legacyUser: false, skillsAutoInstalled: undefined } }));
    expect(result.records['obsidian-markdown'].state).toBe('installed');
  });
});

describe('interrupted and contested installs (evaluator #4, #5)', () => {
  it('cleans up its own staging folder left by a crash and installs', async () => {
    const staging = path.join(vault, '.agents/skills/.installing-pdf');
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, '.obsidian-ai-tutor-staging'), 'v1');
    fs.writeFileSync(path.join(staging, 'SKILL.md'), 'half');
    const result = await ensureRoot(input());
    expect(result.records.pdf.state).toBe('installed');
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.existsSync(path.join(vault, '.agents/skills/pdf/.obsidian-ai-tutor-staging'))).toBe(false);
  });

  it('leaves an update cut off after moving the old copy aside for the student to settle', async () => {
    const first = await ensureRoot(input());
    const old = path.join(vault, '.agents/skills/.installing-pdf-old');
    fs.renameSync(path.join(vault, '.agents/skills/pdf'), old);
    const second = await ensureRoot(input({ records: first.records }));
    expect(second.records.pdf.state).toBe('installed'); // not a tombstone: the student did not delete it
    expect(has('.agents/skills', 'pdf')).toBe(false); // and not restored behind their back
    expect(fs.existsSync(path.join(old, 'scripts/run.py'))).toBe(true);
    expect(second.errors.join('\n')).toMatch(/pdf/);
  });

  it('stops for a skill whose replacement folder it does not own', async () => {
    fs.mkdirSync(path.join(vault, '.agents/skills/.replacing-pdf'), { recursive: true });
    fs.writeFileSync(path.join(vault, '.agents/skills/.replacing-pdf/mine.txt'), 'student');
    const result = await ensureRoot(input());
    expect(has('.agents/skills', 'pdf')).toBe(false);
    expect(result.records.pdf).toBeUndefined();
    expect(result.errors.join('\n')).toMatch(/replacing-pdf/);
    expect(fs.readFileSync(path.join(vault, '.agents/skills/.replacing-pdf/mine.txt'), 'utf8')).toBe('student');
    expect(result.records.xlsx.state).toBe('installed');
  });

  it('does not write into a same-name folder that has no SKILL.md', async () => {
    fs.mkdirSync(path.join(vault, '.agents/skills/obsidian-markdown'), { recursive: true });
    fs.writeFileSync(path.join(vault, '.agents/skills/obsidian-markdown/notes.md'), 'mine');
    const result = await ensureRoot(input());
    expect(result.records['obsidian-markdown'].state).toBe('kept');
    expect(fs.readdirSync(path.join(vault, '.agents/skills/obsidian-markdown'))).toEqual(['notes.md']);
  });

  it('never updates a folder whose marker the student removed', async () => {
    const first = await ensureRoot(input());
    fs.rmSync(path.join(vault, '.agents/skills/pptx', DOC_SKILL_MARKER));
    const second = await ensureRoot(input({ records: first.records, getArchive: async () => archive('v2') }));
    expect(second.records.pptx.state).toBe('kept');
    expect(fs.readFileSync(path.join(vault, '.agents/skills/pptx/scripts/run.py'), 'utf8')).toBe('print("pptxv1")');
  });
});

describe('student content and failed writes (evaluator cycle 3)', () => {
  it('keeps a doc skill holding an empty folder the student made, instead of updating it away', async () => {
    const first = await ensureRoot(input());
    fs.mkdirSync(path.join(vault, '.agents/skills/pdf/my-work'));
    const second = await ensureRoot(input({ records: first.records, getArchive: async () => archive('v2') }));
    expect(second.records.pdf.state).toBe('kept');
    expect(fs.existsSync(path.join(vault, '.agents/skills/pdf/my-work'))).toBe(true);
  });

  it('keeps a student file that happens to carry the staging owner name', async () => {
    const first = await ensureRoot(input());
    const file = path.join(vault, '.agents/skills/pdf/.obsidian-ai-tutor-staging');
    fs.writeFileSync(file, 'mine');
    const second = await ensureRoot(input({ records: first.records, getArchive: async () => archive('v2') }));
    expect(second.records.pdf.state).toBe('kept');
    expect(fs.readFileSync(file, 'utf8')).toBe('mine');
  });

  it('leaves its own staging folder alone once something else was added to it (spar B2)', async () => {
    const staging = path.join(vault, '.agents/skills/.installing-pdf');
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, '.obsidian-ai-tutor-staging'), 'v1');
    fs.writeFileSync(path.join(staging, 'my-notes.md'), 'mine');
    const result = await ensureRoot(input());
    expect(fs.readFileSync(path.join(staging, 'my-notes.md'), 'utf8')).toBe('mine');
    expect(has('.agents/skills', 'pdf')).toBe(false);
    expect(result.errors.join('\n')).toMatch(/installing-pdf/);
  });

  it('removes its own half-written staging folder when a write fails', async () => {
    const realRename = fs.renameSync;
    const spy = jest.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      if (String(b).endsWith(`${path.sep}pdf`)) throw new Error('disk full');
      return realRename(a, b);
    });
    try {
      const result = await ensureRoot(input());
      expect(result.errors.join('\n')).toMatch(/disk full/);
      expect(fs.readdirSync(path.join(vault, '.agents/skills')).filter((n) => n.startsWith('.installing-'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not write a SKILL.md into a same-name folder without one (Settings Install)', async () => {
    const { writeBundledSkill } = await import('@/features/skills/ObsidianSkillsInstaller');
    const dir = path.join(vault, '.agents/skills/json-canvas');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'notes.md'), 'mine');
    expect(writeBundledSkill(path.join(vault, '.agents/skills'), 'json-canvas', 'body')).toBe('kept');
    expect(fs.readdirSync(dir)).toEqual(['notes.md']);
  });
});

describe('parseDocArchive', () => {
  it('rejects a wrong hash', () => {
    const { gz } = makeArchive();
    expect(() => parseDocArchive(gz, '0'.repeat(64))).toThrow(/sha256/);
  });
  it.each([
    ['a path that leaves the folder', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['../evil'] = 'eA=='; }],
    ['an absolute path', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['/etc/x'] = 'eA=='; }],
    ['a backslash path', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['a\\..\\b'] = 'eA=='; }],
    ['a missing LICENSE', (raw: Record<string, unknown>) => { delete (raw.skills as Record<string, Record<string, string>>).xlsx['LICENSE.txt']; }],
    ['an extra skill', (raw: Record<string, unknown>) => { (raw.skills as Record<string, unknown>).evil = { 'SKILL.md': 'eA==' }; }],
    ['a missing skill', (raw: Record<string, unknown>) => { delete (raw.skills as Record<string, unknown>).pptx; }],
    ['a fake marker file', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf[DOC_SKILL_MARKER] = 'eA=='; }],
    ['an executable outside the skill', (raw: Record<string, unknown>) => { (raw.executables as Record<string, string[]>).pdf = ['nope.sh']; }],
    ['a Windows device name', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['scripts/CON.txt'] = 'eA=='; }],
    ['a trailing-dot alias', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['SKILL.md.'] = 'eA=='; }],
    ['a trailing-space alias', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['notes '] = 'eA=='; }],
    ['two paths that differ only in case', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['Scripts/run.py'] = 'eA=='; }],
    ['loose base64', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['extra.txt'] = 'e A=*='; }],
    ['a file that is also a folder', (raw: Record<string, unknown>) => { (raw.skills as Record<string, Record<string, string>>).pdf['scripts/run.py/x'] = 'eA=='; }],
    ['two names that are the same file on macOS (NFC vs NFD)', (raw: Record<string, unknown>) => { const pdf = (raw.skills as Record<string, Record<string, string>>).pdf; pdf['\u00e9.txt'] = 'eA=='; pdf['e\u0301.txt'] = 'eQ=='; }],
    ['a duplicate key in the JSON', (raw: Record<string, unknown>) => { (raw as Record<string, unknown>).__dupe = true; }],
  ])('rejects %s', (_label, mutate) => {
    const { gz, sha } = makeArchive('v1', mutate);
    expect(() => parseDocArchive(gz, sha)).toThrow();
  });
});

describe('Settings Install that could not install (spar B4)', () => {
  it('names a skill whose folder is still there without SKILL.md and says what to do', async () => {
    const { docInstallLeftoverMessage } = await import('@/features/skills/BundledSkills');
    fs.mkdirSync(path.join(vault, '.agents/skills/pdf'), { recursive: true });
    fs.writeFileSync(path.join(vault, '.agents/skills/pdf/notes.md'), 'x');
    fs.mkdirSync(path.join(vault, '.agents/skills/xlsx'), { recursive: true });
    fs.writeFileSync(path.join(vault, '.agents/skills/xlsx/SKILL.md'), 'x');
    const message = docInstallLeftoverMessage(vault, '.agents/skills', ['pdf', 'xlsx', 'docx']);
    expect(message).toMatch(/pdf/);
    expect(message).not.toMatch(/xlsx/);
    expect(message).toMatch(/\.agents\/skills\/pdf/);
    expect(docInstallLeftoverMessage(vault, '.agents/skills', ['xlsx'])).toBeNull();
  });
});
