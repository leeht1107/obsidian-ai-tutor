/**
 * advisor-astra 2026-11-13: the automatic install moved codex and copilot to
 * `<vault>/.agents/skills`, but the Settings list and Remove still read only
 * the manual root (`~/.codex/skills`, `.copilot/skills`). A codex student then
 * could not see or remove the doc skills the plugin had just put there.
 */
jest.mock('obsidian', () => ({ Notice: jest.fn(), requestUrl: jest.fn() }), { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getInstalledSkills, removeSkill } from '@/features/skills/ObsidianSkillsInstaller';

function makeSkill(dir: string, body = '---\nname: x\ndescription: test skill\n---\n') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
}

describe('Settings skill list for the shared .agents root', () => {
  let vault: string;
  let codexHome: string;
  const previous = process.env.CODEX_HOME;
  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codexhome-'));
    process.env.CODEX_HOME = codexHome;
  });
  afterAll(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });

  const app = () => ({ vault: { adapter: { basePath: vault } } }) as never;

  it('lists an auto-installed skill for codex', () => {
    makeSkill(path.join(vault, '.agents/skills/pdf'));
    const names = getInstalledSkills(app(), 'codex').map((s) => s.name);
    expect(names).toContain('pdf');
  });

  it('removes exactly the row that was clicked', async () => {
    const shared = path.join(vault, '.agents/skills/pdf');
    const manual = path.join(codexHome, 'skills/pdf');
    makeSkill(shared);
    makeSkill(manual, '---\nname: pdf\ndescription: my own\n---\n');
    const row = getInstalledSkills(app(), 'codex').find((s) => s.path === shared);
    expect(row).toBeDefined();
    expect(await removeSkill(app(), 'pdf', 'codex', undefined, row!.path)).toBe(true);
    expect(fs.existsSync(shared)).toBe(false);
    expect(fs.readFileSync(path.join(manual, 'SKILL.md'), 'utf8')).toContain('my own');
  });

  it('refuses a path outside the provider roots', async () => {
    const outside = path.join(vault, 'notes/pdf');
    makeSkill(outside);
    expect(await removeSkill(app(), 'pdf', 'codex', undefined, outside)).toBe(false);
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe('Removing the built-in Obsidian skills (evaluator cycle 2 #4)', () => {
  it('takes only the file the plugin wrote and keeps a student file beside it', async () => {
    const { uninstallObsidianSkills, writeBundledSkill } = await import('@/features/skills/ObsidianSkillsInstaller');
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
    const root = path.join(vault, '.agents/skills');
    writeBundledSkill(root, 'obsidian-markdown', '---\nname: obsidian-markdown\n---\n');
    writeBundledSkill(root, 'json-canvas', '---\nname: json-canvas\n---\n');
    fs.writeFileSync(path.join(root, 'obsidian-markdown/notes.md'), 'mine');
    const ok = await uninstallObsidianSkills({ vault: { adapter: { basePath: vault } } } as never, 'codex');
    expect(ok).toBe(true);
    expect(fs.readdirSync(path.join(root, 'obsidian-markdown'))).toEqual(['notes.md']);
    expect(fs.existsSync(path.join(root, 'json-canvas'))).toBe(false);
  });
});
