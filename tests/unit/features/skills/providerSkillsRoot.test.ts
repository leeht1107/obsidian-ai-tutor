/**
 * Where each CLI looks for skills.
 *
 * The installer wrote to `<vault>/.copilot/skills/` whatever provider was
 * selected — a leftover from when this plugin was Copilot-only. A student on
 * Claude Code got the two Obsidian skills installed into a folder their CLI
 * never reads, so the feature reported success and did nothing.
 *
 * Every path below came from the CLI itself, not from a subcommand listing:
 *   copilot — the folder this plugin has always written, beside its other
 *             `.copilot/` state in the vault
 *   claude  — Claude Code's project skills directory
 *   agy     — printed by the binary: "`<workspace>/.agents/skills/<name>/` or
 *             `~/.gemini/config/skills/<name>/`"
 *   codex   — `$CODEX_HOME/skills/<skill-name>` (defaults to `~/.codex/skills`),
 *             also from the binary. It is the one that is NOT per-vault, and an
 *             earlier version of this file wrongly claimed codex had no skills
 *             at all because `codex --help` lists no skills subcommand.
 */
import * as os from 'os';
import * as path from 'path';

import { providerSkillsRoot } from '@/features/skills/ObsidianSkillsInstaller';

describe('providerSkillsRoot', () => {
  it('points each vault-local CLI at the folder it actually reads', () => {
    expect(providerSkillsRoot('/vault', 'copilot')).toBe('/vault/.copilot/skills');
    expect(providerSkillsRoot('/vault', 'claude')).toBe('/vault/.claude/skills');
    expect(providerSkillsRoot('/vault', 'agy')).toBe('/vault/.agents/skills');
  });

  it('sends codex to its home directory, which is where codex actually looks', () => {
    const previous = process.env.CODEX_HOME;
    delete process.env.CODEX_HOME;
    // Not under the vault: codex keeps skills per machine, not per workspace.
    expect(providerSkillsRoot('/vault', 'codex')).toBe(path.join(os.homedir(), '.codex', 'skills'));
    if (previous !== undefined) process.env.CODEX_HOME = previous;
  });

  it('honours CODEX_HOME, which codex itself honours', () => {
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = '/somewhere/codex';
    expect(providerSkillsRoot('/vault', 'codex')).toBe('/somewhere/codex/skills');
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  });
});
