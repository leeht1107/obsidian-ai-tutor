/**
 * What the automatic install is allowed to touch.
 *
 * Both independent reviewers called this a blocker, and they were right: the
 * install wrote `obsidian-markdown/SKILL.md` and `json-canvas/SKILL.md`
 * unconditionally, into whatever folder the selected provider reads. For codex
 * that folder is `~/.codex/skills` — outside the vault, shared by every codex
 * session on the machine — and a student or a teacher who already had a skill
 * of either name would have had it replaced with no prompt and no backup.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isPluginOwnedSkill, shouldInstallBundledSkills, writeBundledSkill } from '@/features/skills/ObsidianSkillsInstaller';

describe('shouldInstallBundledSkills', () => {
  it('installs into a vault folder that has never had them', () => {
    expect(shouldInstallBundledSkills({}, 'claude', false)).toBe(true);
  });

  it('never installs automatically outside the vault', () => {
    // codex keeps skills in CODEX_HOME. Writing there on launch would change
    // every codex session on the computer without anyone asking for it; the
    // settings button still can, because that is a deliberate click.
    expect(shouldInstallBundledSkills({}, 'codex', false)).toBe(false);
  });

  it('does not reinstall over an existing install', () => {
    expect(shouldInstallBundledSkills({}, 'claude', true)).toBe(false);
  });

  it('never puts back what the student removed', () => {
    expect(shouldInstallBundledSkills({ skillsAutoInstalled: { claude: true } }, 'claude', false)).toBe(false);
  });

  it('still installs for a provider that was never set up, after a switch', () => {
    expect(shouldInstallBundledSkills({ skillsAutoInstalled: { copilot: true } }, 'claude', false)).toBe(true);
  });
});

describe('writeBundledSkill', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('writes a skill that is not there yet', () => {
    expect(writeBundledSkill(root, 'obsidian-markdown', '# body')).toBe('written');
    expect(fs.readFileSync(path.join(root, 'obsidian-markdown', 'SKILL.md'), 'utf-8')).toContain('# body');
  });

  it('keeps a skill of the same name that somebody else wrote', () => {
    const file = path.join(root, 'obsidian-markdown', 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'my own skill', 'utf-8');

    expect(writeBundledSkill(root, 'obsidian-markdown', '# body')).toBe('kept');
    expect(fs.readFileSync(file, 'utf-8')).toBe('my own skill');
  });

  it('does update the copy it wrote itself', () => {
    writeBundledSkill(root, 'json-canvas', '# first');
    expect(writeBundledSkill(root, 'json-canvas', '# second')).toBe('written');
    expect(fs.readFileSync(path.join(root, 'json-canvas', 'SKILL.md'), 'utf-8')).toContain('# second');
  });

  it('marks what it wrote so the next install can tell', () => {
    writeBundledSkill(root, 'json-canvas', '# body');
    const written = fs.readFileSync(path.join(root, 'json-canvas', 'SKILL.md'), 'utf-8');
    expect(isPluginOwnedSkill(written)).toBe(true);
    expect(isPluginOwnedSkill('someone else')).toBe(false);
    // The marker must not break the frontmatter a SKILL.md starts with.
    expect(written.startsWith('# body')).toBe(true);
  });
});
