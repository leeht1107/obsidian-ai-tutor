/**
 * Obsidian Skills Installer
 * 
 * Installs pre-bundled Obsidian skills to the vault's .copilot/skills folder.
 */

import * as fs from 'fs';
import type { App } from 'obsidian';
import { Notice, requestUrl } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import type { ProviderId } from '../../core/providers/providerRegistry';
import { getVaultPath } from '../../utils/path';

/** Bundled skill files to install */
const OBSIDIAN_MARKDOWN_SKILL = `---
name: obsidian-markdown
description: Create and edit Obsidian Flavored Markdown with wikilinks, embeds, callouts, properties, and other Obsidian-specific syntax. Use when working with .md files in Obsidian, or when the user mentions wikilinks, callouts, frontmatter, tags, embeds, or Obsidian notes.
---

# Obsidian Flavored Markdown Skill

This skill enables skills-compatible agents to create and edit valid Obsidian Flavored Markdown, including all Obsidian-specific syntax extensions.

## Overview

Obsidian uses a combination of Markdown flavors:
- [CommonMark](https://commonmark.org/)
- [GitHub Flavored Markdown](https://github.github.com/gfm/)
- [LaTeX](https://www.latex-project.org/) for math
- Obsidian-specific extensions (wikilinks, callouts, embeds, etc.)

## Internal Links (Wikilinks)

\`\`\`markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
\`\`\`

## Embeds

\`\`\`markdown
![[Note Name]]
![[image.png]]
![[image.png|300]]
![[document.pdf#page=3]]
\`\`\`

## Callouts

\`\`\`markdown
> [!note]
> This is a note callout.

> [!tip] Custom Title
> This callout has a custom title.

> [!warning]- Collapsed by default
> This content is hidden until expanded.
\`\`\`

### Supported Callout Types

| Type | Aliases |
|------|---------|
| \`note\` | - |
| \`abstract\` | \`summary\`, \`tldr\` |
| \`info\` | - |
| \`todo\` | - |
| \`tip\` | \`hint\`, \`important\` |
| \`success\` | \`check\`, \`done\` |
| \`question\` | \`help\`, \`faq\` |
| \`warning\` | \`caution\`, \`attention\` |
| \`failure\` | \`fail\`, \`missing\` |
| \`danger\` | \`error\` |
| \`bug\` | - |
| \`example\` | - |
| \`quote\` | \`cite\` |

## Task Lists

\`\`\`markdown
- [ ] Incomplete task
- [x] Completed task
\`\`\`

## Properties (Frontmatter)

\`\`\`yaml
---
title: My Note Title
date: 2024-01-15
tags:
  - project
  - important
aliases:
  - My Note
---
\`\`\`

## Tags

\`\`\`markdown
#tag
#nested/tag
#tag-with-dashes
\`\`\`

## Math (LaTeX)

\`\`\`markdown
Inline: $e^{i\\pi} + 1 = 0$

Block:
$$
\\frac{a}{b}
$$
\`\`\`

## Diagrams (Mermaid)

\`\`\`\`markdown
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do this]
    B -->|No| D[Do that]
\`\`\`
\`\`\`\`

## Comments

\`\`\`markdown
This is visible %%but this is hidden%% text.
\`\`\`

## References

- [Basic formatting syntax](https://help.obsidian.md/syntax)
- [Obsidian Flavored Markdown](https://help.obsidian.md/obsidian-flavored-markdown)
- [Internal links](https://help.obsidian.md/links)
- [Callouts](https://help.obsidian.md/callouts)
- [Properties](https://help.obsidian.md/properties)
`;

const JSON_CANVAS_SKILL = `---
name: json-canvas
description: Create and edit JSON Canvas files (.canvas) for visual note-taking and mind mapping in Obsidian. Use when the user wants to create visual diagrams, mind maps, or canvas views.
---

# JSON Canvas Skill

JSON Canvas is an open file format for infinite canvas tools. Obsidian uses this format for .canvas files.

## File Structure

\`\`\`json
{
  "nodes": [],
  "edges": []
}
\`\`\`

## Node Types

### Text Node
\`\`\`json
{
  "id": "unique-id",
  "type": "text",
  "x": 0,
  "y": 0,
  "width": 250,
  "height": 60,
  "text": "Your text content here"
}
\`\`\`

### File Node
\`\`\`json
{
  "id": "unique-id",
  "type": "file",
  "x": 300,
  "y": 0,
  "width": 400,
  "height": 400,
  "file": "path/to/note.md"
}
\`\`\`

### Link Node
\`\`\`json
{
  "id": "unique-id",
  "type": "link",
  "x": 0,
  "y": 200,
  "width": 400,
  "height": 300,
  "url": "https://example.com"
}
\`\`\`

### Group Node
\`\`\`json
{
  "id": "unique-id",
  "type": "group",
  "x": -50,
  "y": -50,
  "width": 500,
  "height": 400,
  "label": "Group Label"
}
\`\`\`

## Edges (Connections)

\`\`\`json
{
  "id": "edge-id",
  "fromNode": "node-id-1",
  "toNode": "node-id-2",
  "fromSide": "right",
  "toSide": "left",
  "label": "Connection label"
}
\`\`\`

### Side Values
- \`top\`, \`right\`, \`bottom\`, \`left\`

## Node Colors

Use the \`color\` property with values: \`1\`-\`6\` (preset colors) or hex codes.

\`\`\`json
{
  "id": "colored-node",
  "type": "text",
  "color": "1",
  "text": "Red node"
}
\`\`\`

## Complete Example

\`\`\`json
{
  "nodes": [
    {
      "id": "main",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 200,
      "height": 60,
      "text": "Main Idea",
      "color": "1"
    },
    {
      "id": "sub1",
      "type": "text",
      "x": 300,
      "y": -80,
      "width": 150,
      "height": 50,
      "text": "Sub-topic 1"
    },
    {
      "id": "sub2",
      "type": "text",
      "x": 300,
      "y": 80,
      "width": 150,
      "height": 50,
      "text": "Sub-topic 2"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "fromNode": "main",
      "toNode": "sub1",
      "fromSide": "right",
      "toSide": "left"
    },
    {
      "id": "e2",
      "fromNode": "main",
      "toNode": "sub2",
      "fromSide": "right",
      "toSide": "left"
    }
  ]
}
\`\`\`

## References

- [JSON Canvas Specification](https://jsoncanvas.org/)
- [Obsidian Canvas Documentation](https://help.obsidian.md/Plugins/Canvas)
`;

/** Installed skill information */
export interface InstalledSkill {
  name: string;
  description: string;
  path: string;
  isBuiltIn: boolean;
  isGlobal: boolean;
}

/**
 * Where one CLI looks for skills in the workspace.
 *
 * This was `.copilot/skills` for everybody — a leftover from when the plugin
 * was Copilot-only. A student on Claude Code had the skills installed into a
 * folder their CLI never reads, and the feature reported success.
 *
 * Each path is the CLI's own. agy prints its own: "`<workspace>/.agents/skills/
 * <name>/` or `~/.gemini/config/skills/<name>/`". codex prints "Installs into
 * `$CODEX_HOME/skills/<skill-name>` (defaults to `~/.codex/skills`)" — the one
 * provider whose skills live per machine rather than per vault, and the one
 * this file once wrongly described as having no skills at all, on the strength
 * of `codex --help` listing no skills subcommand.
 */
export function providerSkillsRoot(vaultPath: string, providerId: ProviderId): string {
  switch (providerId) {
    case 'copilot': return path.join(vaultPath, '.copilot', 'skills');
    case 'claude': return path.join(vaultPath, '.claude', 'skills');
    case 'agy': return path.join(vaultPath, '.agents', 'skills');
    case 'codex': return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills');
  }
}

/** True when this provider keeps its skills outside the vault, for the machine. */
export function isMachineWideSkillsRoot(providerId: ProviderId): boolean {
  return providerId === 'codex';
}

/**
 * The machine-wide skills folder each CLI also reads.
 *
 * Hardcoded to `~/.copilot/skills` before, so a Claude Code student saw
 * somebody else's Copilot skills listed and none of their own. codex answers
 * null because its only folder is already the machine-wide one above, and
 * listing it twice would show two entries for one file.
 */
export function providerGlobalSkillsRoot(providerId: ProviderId): string | null {
  switch (providerId) {
    case 'copilot': return path.join(os.homedir(), '.copilot', 'skills');
    case 'claude': return path.join(os.homedir(), '.claude', 'skills');
    case 'agy': return path.join(os.homedir(), '.gemini', 'config', 'skills');
    case 'codex': return null;
  }
}

/** The selected provider's skills folder, or null when the vault path is unknown. */
function resolveSkillsRoot(app: App, providerId: ProviderId): string | null {
  const vaultPath = getVaultPath(app);
  return vaultPath ? providerSkillsRoot(vaultPath, providerId) : null;
}

/**
 * Whether the plugin should install its bundled skills by itself.
 *
 * Never automatically outside the vault: codex keeps skills in CODEX_HOME, so
 * a silent write there would change every codex session on the computer. The
 * settings button still installs it, because that is a deliberate click.
 *
 * Once per provider otherwise. A student who removes them keeps them removed,
 * and switching provider means a folder that has never had them.
 */
export function shouldInstallBundledSkills(
  state: { skillsAutoInstalled?: Partial<Record<ProviderId, boolean>> },
  providerId: ProviderId,
  alreadyInstalled: boolean
): boolean {
  if (isMachineWideSkillsRoot(providerId)) return false;
  return !state.skillsAutoInstalled?.[providerId] && !alreadyInstalled;
}

/**
 * The line that says this plugin wrote a skill file. At the end, never the
 * start: a SKILL.md begins with its frontmatter fence, and anything above it
 * stops the CLI parsing the file.
 */
const OWNERSHIP_MARKER = '\n<!-- obsidian-ai-tutor: bundled skill. Delete this line to keep your own edits. -->\n';

export function isPluginOwnedSkill(content: string): boolean {
  return content.includes(OWNERSHIP_MARKER.trim());
}

/**
 * Write one bundled skill, unless somebody else's file is already there.
 *
 * The previous version overwrote whatever it found. A teacher with hand-written
 * skills in `.claude/skills` would have lost any that happened to share a name
 * — silently, on plugin launch. A file this plugin did not write is left alone.
 */
export function writeBundledSkill(root: string, name: string, body: string): 'written' | 'kept' {
  const file = path.join(root, name, 'SKILL.md');
  if (fs.existsSync(file) && !isPluginOwnedSkill(fs.readFileSync(file, 'utf-8'))) return 'kept';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${body}${OWNERSHIP_MARKER}`, 'utf-8');
  return 'written';
}

/** Built-in skill names (bundled with the plugin) */
const BUILT_IN_SKILLS = ['obsidian-markdown', 'json-canvas'];

/** Check if obsidian skills are already installed */
export function isObsidianSkillsInstalled(app: App, providerId: ProviderId): boolean {
  const root = resolveSkillsRoot(app, providerId);
  // Both files, not just the first folder: an install that failed halfway
  // otherwise reported success and was never retried.
  return root !== null && BUILT_IN_SKILLS.every((name) => fs.existsSync(path.join(root, name, 'SKILL.md')));
}

/** Get all installed skills in the vault */
export function getInstalledSkills(app: App, providerId: ProviderId): InstalledSkill[] {
  const skillsBasePath = resolveSkillsRoot(app, providerId);
  const globalRoot = providerGlobalSkillsRoot(providerId);

  const globalSkills = globalRoot ? loadSkillsFromPath(globalRoot, true) : [];
  const vaultSkills: InstalledSkill[] = [];

  if (skillsBasePath) {
    vaultSkills.push(...loadSkillsFromPath(skillsBasePath, false));
  }

  const vaultNames = new Set(vaultSkills.map((skill) => skill.name));
  const mergedSkills = [
    ...globalSkills.filter((skill) => !vaultNames.has(skill.name)),
    ...vaultSkills,
  ];

  return mergedSkills.sort((a, b) => {
    if (a.isBuiltIn && !b.isBuiltIn) return -1;
    if (!a.isBuiltIn && b.isBuiltIn) return 1;
    if (a.isGlobal && !b.isGlobal) return -1;
    if (!a.isGlobal && b.isGlobal) return 1;
    return a.name.localeCompare(b.name);
  });
}

function loadSkillsFromPath(skillsBasePath: string, isGlobal: boolean): InstalledSkill[] {
  const skills: InstalledSkill[] = [];

  if (!fs.existsSync(skillsBasePath)) {
    return skills;
  }

  try {
    const entries = fs.readdirSync(skillsBasePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // An install in progress, or the folder it moved aside, is not a skill.
      if (entry.name.startsWith(STAGING_PREFIX)
        || entry.name.startsWith(REPLACING_PREFIX)
        || entry.name.startsWith(REPLACED_PREFIX)) continue;

      const skillDir = path.join(skillsBasePath, entry.name);
      const skillFilePath = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFilePath)) continue;

      let description = '';
      try {
        const content = fs.readFileSync(skillFilePath, 'utf-8');
        const descMatch = content.match(/^---\s*[\s\S]*?description:\s*([^\r\n]+)/);
        if (descMatch && descMatch[1]) {
          description = descMatch[1].trim();
        }
      } catch {
        // Ignore malformed or unreadable skill metadata and show the fallback description.
      }

      skills.push({
        name: entry.name,
        description: description || 'No description available',
        path: skillDir,
        isBuiltIn: BUILT_IN_SKILLS.includes(entry.name),
        isGlobal,
      });
    }
  } catch {
    // Ignore unreadable skills directories; callers treat an empty list as no installed skills.
  }

  return skills;
}

/** Remove a specific skill by name */
export async function removeSkill(app: App, skillName: string, providerId: ProviderId): Promise<boolean> {
  const skillsRoot = resolveSkillsRoot(app, providerId);
  if (!skillsRoot) {
    new Notice('Could not determine skills folder');
    return false;
  }

  try {
    const skillPath = path.join(skillsRoot, skillName);

    if (!fs.existsSync(skillPath)) {
      new Notice(`Skill "${skillName}" not found`);
      return false;
    }

    fs.rmSync(skillPath, { recursive: true });
    new Notice(`Skill "${skillName}" removed`);
    return true;
  } catch (error) {
    console.error(`Failed to remove skill "${skillName}":`, error);
    new Notice(`Failed to remove skill: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Install obsidian skills to the vault */
export async function installObsidianSkills(app: App, providerId: ProviderId): Promise<boolean> {
  const skillsBasePath = resolveSkillsRoot(app, providerId);
  // No vault path yet; the automatic install stays silent and tries again.
  if (!skillsBasePath) return false;

  try {
    const kept = [
      writeBundledSkill(skillsBasePath, 'obsidian-markdown', OBSIDIAN_MARKDOWN_SKILL),
      writeBundledSkill(skillsBasePath, 'json-canvas', JSON_CANVAS_SKILL),
    ].filter((result) => result === 'kept').length;
    // Saying so matters: part of what was asked for did not happen, because
    // the student's own file of that name is worth more than ours.
    new Notice(kept > 0
      ? `같은 이름의 스킬이 이미 있어 ${kept}개는 그대로 두었습니다.`
      : '✅ Obsidian 스킬을 설치했습니다.');
    return true;
  } catch (error) {
    console.error('Failed to install Obsidian Skills:', error);
    new Notice(`Failed to install skills: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Uninstall obsidian skills from the vault */
export async function uninstallObsidianSkills(app: App, providerId: ProviderId): Promise<boolean> {
  const skillsBasePath = resolveSkillsRoot(app, providerId);
  if (!skillsBasePath) {
    new Notice('Could not determine skills folder');
    return false;
  }

  try {
    // Only the copies this plugin wrote. A skill of the same name the student
    // wrote themselves is theirs, and Remove must not take it.
    for (const name of BUILT_IN_SKILLS) {
      const file = path.join(skillsBasePath, name, 'SKILL.md');
      if (!fs.existsSync(file) || !isPluginOwnedSkill(fs.readFileSync(file, 'utf-8'))) continue;
      fs.rmSync(path.join(skillsBasePath, name), { recursive: true });
    }

    new Notice('Obsidian Skills removed');
    return true;
  } catch (error) {
    console.error('Failed to uninstall Obsidian Skills:', error);
    new Notice(`Failed to remove skills: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Get the default branch of a GitHub repository */
async function getRepoDefaultBranch(owner: string, repo: string): Promise<string> {
  try {
    const response = await requestUrl({
      url: `https://api.github.com/repos/${owner}/${repo}`,
      throw: false
    });
    if (response.status === 200) {
      const data = JSON.parse(response.text);
      return data.default_branch || 'main';
    }
  } catch (e) {
    console.warn('Failed to fetch default branch, defaulting to main:', e);
  }
  return 'main';
}

/** Check if a raw URL exists */
async function checkRawUrl(url: string): Promise<boolean> {
  try {
    const res = await requestUrl({ url, throw: false });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** Find SKILL.md in a GitHub repository by searching common paths */
async function findSkillInRepo(repoUrl: string): Promise<string | null> {
  // Extract owner/repo from URL: https://github.com/owner/repo
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;

  const [, owner, repo] = match;
  const cleanRepo = repo.replace(/\.git$/, '');

  // Dynamic branch detection
  const branch = await getRepoDefaultBranch(owner, cleanRepo);

  // List of potential URL patterns to check
  const candidates = [
    // Root level SKILL.md
    `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/SKILL.md`,
    // Inside a 'skill' or 'skills' directory
    `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/skill/SKILL.md`,
    `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/skills/SKILL.md`,
    // Check for README.md if SKILL.md is missing (sometimes users put skill definition there)
    `https://raw.githubusercontent.com/${owner}/${cleanRepo}/${branch}/README.md`,
  ];

  for (const url of candidates) {
    if (await checkRawUrl(url)) {
      return url;
    }
  }

  return null;
}

/** A GitHub folder that holds one skill: `https://github.com/<owner>/<repo>/tree/<ref>/<dir>`. */
export interface GitHubFolderRef {
  owner: string;
  repo: string;
  ref: string;
  dir: string;
}

/** One entry of a GitHub contents listing, narrowed to the fields an install needs. */
export interface RemoteEntry {
  path: string;
  type: 'file' | 'dir';
  download_url: string | null;
  /** Bytes, as reported by the GitHub contents listing. */
  size?: number;
}

export interface RemoteFile {
  relativePath: string;
  downloadUrl: string;
  size?: number;
}

/** A skill folder is a handful of small files. Anything larger is a repository, not a skill. */
const MAX_SKILL_FILES = 60;
const MAX_SKILL_BYTES = 8 * 1024 * 1024;
/** Each subfolder costs one call against GitHub's 60-per-hour unauthenticated allowance. */
const MAX_SKILL_DIRS = 16;

/** Written into a folder-installed skill so a later install knows it may replace it. */
const FOLDER_INSTALL_MARKER = '.obsidian-ai-tutor-installed';
/** Working folders an install leaves beside the skill; never skills themselves. */
const STAGING_PREFIX = '.installing-';
const REPLACING_PREFIX = '.replacing-';
/** The copy a successful reinstall replaced, kept one generation deep so a student's own edits are recoverable. */
const REPLACED_PREFIX = '.replaced-';

/**
 * The absolute path `relativePath` names inside `skillDir`, or null if it would land
 * anywhere else. `path.join` treats a backslash as a separator on Windows, so a guard
 * that only looks at "/" lets `sub\..\..\evil` out of the folder.
 */
export function isSafeSkillRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes('\\')) return false;
  // An empty segment covers a leading slash and a doubled one; "." and ".." cover
  // the aliases that resolve back out of the folder from anywhere in the path.
  return relativePath.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

export function resolveSkillFilePath(skillDir: string, relativePath: string): string | null {
  if (!isSafeSkillRelativePath(relativePath)) return null;
  const base = path.resolve(skillDir);
  const target = path.resolve(base, relativePath);
  return target.startsWith(base + path.sep) ? target : null;
}

export function parseGitHubFolderUrl(url: string): GitHubFolderRef | null {
  const match = url.trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/);
  if (!match) return null;
  const [, owner, repo, ref, dir] = match;
  // Only a markdown target is the single-file path. Testing for "any extension"
  // sent a folder legitimately named `docx.v2` or `v1.2` down it as well.
  if (/\.md$/i.test(dir)) return null;
  return { owner, repo: repo.replace(/\.git$/, ''), ref, dir };
}

/**
 * Every file under the skill folder, paths relative to it.
 *
 * The old install downloaded SKILL.md alone. Anthropic's own docx/pptx/xlsx skills
 * tell the CLI to run `python scripts/merge_runs.py`, so a one-file install reported
 * success and then failed on first use — the exact shape of bug this settings screen
 * keeps producing.
 */
export async function collectFolderFiles(
  folder: GitHubFolderRef,
  listDir: (dirPath: string) => Promise<RemoteEntry[]>,
  maxFiles = MAX_SKILL_FILES
): Promise<RemoteFile[]> {
  const files: RemoteFile[] = [];
  let bytes = 0;
  let dirs = 0;

  const walk = async (dirPath: string): Promise<void> => {
    if (dirs++ >= MAX_SKILL_DIRS) {
      throw new Error(`That folder has too many folders inside it to install as one skill (limit ${MAX_SKILL_DIRS}).`);
    }
    for (const entry of await listDir(dirPath)) {
      if (files.length >= maxFiles) {
        throw new Error(`That folder has too many files to install as one skill (limit ${maxFiles}).`);
      }
      if (entry.type === 'dir') {
        await walk(entry.path);
        continue;
      }
      if (!entry.download_url) continue;
      const relativePath = entry.path.slice(folder.dir.length + 1);
      // Refuse rather than skip: a skill missing one of its scripts installs
      // clean and then fails on first use, which is the bug this path exists to
      // stop. The containment check runs here so nothing is downloaded first.
      if (!isSafeSkillRelativePath(relativePath)) {
        throw new Error(`That folder contains an unsafe path (${entry.path}).`);
      }
      bytes += entry.size ?? 0;
      if (bytes > MAX_SKILL_BYTES) {
        throw new Error(`That folder is too large to install as one skill (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
      }
      files.push({ relativePath, downloadUrl: entry.download_url, size: entry.size });
    }
  };

  await walk(folder.dir);

  if (!files.some((file) => file.relativePath === 'SKILL.md')) {
    throw new Error('That folder has no SKILL.md, so no CLI would load it as a skill.');
  }
  return files;
}

async function listGitHubDir(folder: GitHubFolderRef, dirPath: string): Promise<RemoteEntry[]> {
  const url = `https://api.github.com/repos/${folder.owner}/${folder.repo}/contents/${dirPath}?ref=${folder.ref}`;
  const response = await requestUrl({ url, throw: false });
  // Unauthenticated callers get 60 listings an hour per IP. A computer lab shares
  // one, so a whole class can hit this; "403" alone reads as a permission problem.
  if (response.status === 403 || response.status === 429) {
    throw new Error('GitHub is rate-limiting this computer. Wait an hour, or install the skill folder by hand.');
  }
  if (response.status !== 200) {
    throw new Error(`GitHub would not list that folder (status ${response.status}).`);
  }
  const data = JSON.parse(response.text);
  if (!Array.isArray(data)) throw new Error('That URL points at a file, not a folder.');
  return data as RemoteEntry[];
}

/** Install every file of a GitHub skill folder, keeping its internal layout. */
async function installSkillFolder(
  folder: GitHubFolderRef,
  providerId: ProviderId,
  vaultPath: string
): Promise<boolean> {
  new Notice(`Reading ${folder.dir}...`);
  const files = await collectFolderFiles(folder, (dirPath) => listGitHubDir(folder, dirPath));

  const manifestFile = files.find((file) => file.relativePath === 'SKILL.md')!;
  if ((manifestFile.size ?? 0) > MAX_SKILL_BYTES) {
    throw new Error(`That folder's SKILL.md is too large to install (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
  }
  const manifest = await requestUrl({ url: manifestFile.downloadUrl, throw: false });
  if (manifest.status !== 200) throw new Error(`Failed to download SKILL.md (status ${manifest.status}).`);
  if (manifest.arrayBuffer.byteLength > MAX_SKILL_BYTES) {
    throw new Error(`That folder's SKILL.md is too large to install (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
  }
  const nameMatch = manifest.text.match(/^---\s*[\s\S]*?name:\s*([^\r\n]+)/);
  const declaredName = nameMatch?.[1]?.trim().replace(/^['"]|['"]$/g, '').trim();
  const skillName = (declaredName || folder.dir.split('/').pop() || 'unknown-skill')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'unknown-skill';

  const skillsRoot = providerSkillsRoot(vaultPath, providerId);
  const skillDir = path.join(skillsRoot, skillName);
  // A folder this plugin did not create is someone's own work. Refuse it rather
  // than replace it; the same rule the bundled skills follow.
  if (fs.existsSync(skillDir) && !fs.existsSync(path.join(skillDir, FOLDER_INSTALL_MARKER))) {
    throw new Error(`"${skillName}" already exists and was not installed by this plugin. Remove that folder first if you want to replace it.`);
  }

  const backupDir = path.join(skillsRoot, `${REPLACING_PREFIX}${skillName}`);
  if (fs.existsSync(backupDir)) {
    // A previous install died between the two renames. The folder sitting here is
    // the student's last working copy, so it is put back or handed to them — never
    // cleared to make room for this run.
    if (!fs.existsSync(skillDir)) {
      fs.renameSync(backupDir, skillDir);
    } else {
      throw new Error(`An earlier install of "${skillName}" was interrupted and left a copy in "${REPLACING_PREFIX}${skillName}". Move or delete that folder, then install again.`);
    }
  }

  // Download into a staging folder and swap it in only once every file is on
  // disk. Writing straight into skillDir left a skill whose SKILL.md was present
  // and whose scripts were not — installed to the CLI, broken on first use.
  const stagingDir = path.join(skillsRoot, `${STAGING_PREFIX}${skillName}`);
  // The cleanup below deletes this folder recursively, so it may only ever delete
  // a folder this run created. Anything already sitting here belongs to someone.
  if (fs.existsSync(stagingDir)) {
    throw new Error(`A folder named "${STAGING_PREFIX}${skillName}" is already in the skills folder. Move or delete it, then install again.`);
  }
  fs.mkdirSync(stagingDir, { recursive: true });
  // The old folder is moved aside, not deleted, and only dropped once the new one
  // is in place. A rename that fails must not cost a student the skill they had.
  try {
    new Notice(`Downloading ${files.length} files...`);
    // SKILL.md is already in hand from the name lookup above; fetching it twice
    // doubles the request count against a rate limit this path can already hit.
    let bytes = manifest.arrayBuffer.byteLength;
    for (const file of files) {
      const target = resolveSkillFilePath(stagingDir, file.relativePath);
      if (!target) throw new Error(`Refused an unsafe path in that folder (${file.relativePath}).`);
      let body = file === manifestFile ? manifest.arrayBuffer : null;
      if (!body) {
        // requestUrl has no streaming form, so a file is whole in memory before it
        // can be measured. Refusing on the listed size first keeps the common
        // oversized case out of the heap; the check after is the backstop for a
        // size that was missing or lied.
        if (bytes + (file.size ?? 0) > MAX_SKILL_BYTES) {
          throw new Error(`That folder is too large to install as one skill (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
        }
        const response = await requestUrl({ url: file.downloadUrl, throw: false });
        if (response.status !== 200) {
          throw new Error(`Failed to download ${file.relativePath} (status ${response.status}).`);
        }
        body = response.arrayBuffer;
        bytes += body.byteLength;
        if (bytes > MAX_SKILL_BYTES) {
          throw new Error(`That folder is too large to install as one skill (limit ${Math.round(MAX_SKILL_BYTES / 1024 / 1024)} MB).`);
        }
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(body));
    }
    fs.writeFileSync(
      path.join(stagingDir, FOLDER_INSTALL_MARKER),
      `${folder.owner}/${folder.repo} ${folder.ref} ${folder.dir}\n`,
      'utf-8'
    );

    const hadPrevious = fs.existsSync(skillDir);
    if (hadPrevious) fs.renameSync(skillDir, backupDir);
    try {
      fs.renameSync(stagingDir, skillDir);
    } catch (error) {
      if (hadPrevious && !fs.existsSync(skillDir)) fs.renameSync(backupDir, skillDir);
      throw error;
    }
    // The folder that was just replaced may hold the student's own edits, so one
    // generation is kept beside the skill instead of deleted.
    const replacedDir = path.join(skillsRoot, `${REPLACED_PREFIX}${skillName}`);
    if (hadPrevious) {
      // Rotate only over a folder this plugin wrote. Anything else with that name
      // is someone's, so the copy stays where it is and the student is told where.
      if (!fs.existsSync(replacedDir) || fs.existsSync(path.join(replacedDir, FOLDER_INSTALL_MARKER))) {
        fs.rmSync(replacedDir, { recursive: true, force: true });
        fs.renameSync(backupDir, replacedDir);
      } else {
        new Notice(`Your previous copy is in "${REPLACING_PREFIX}${skillName}" — "${REPLACED_PREFIX}${skillName}" was already taken.`);
      }
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  new Notice(`✅ Skill "${skillName}" installed (${files.length} files).`);
  return true;
}

/** Install a skill from a GitHub URL */
export async function installSkillFromUrl(app: App, url: string, providerId: ProviderId): Promise<boolean> {
  const vaultPath = getVaultPath(app);
  if (!vaultPath) {
    new Notice('Could not determine vault path');
    return false;
  }

  try {
    // A folder URL brings the whole skill down, scripts included.
    const folder = parseGitHubFolderUrl(url);
    if (folder) return await installSkillFolder(folder, providerId, vaultPath);

    let rawUrl = url;

    // Convert GitHub blob/repo URLs to raw.githubusercontent.com
    if (url.includes('github.com') && !url.includes('raw.githubusercontent.com')) {
      // Handle: https://github.com/user/repo/blob/branch/file.md
      if (url.includes('/blob/')) {
        rawUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      }
      // Handle: https://github.com/user/repo/tree/branch/path (folder URL)
      else if (url.includes('/tree/')) {
        rawUrl = url
          .replace('github.com', 'raw.githubusercontent.com')
          .replace('/tree/', '/');
        // If URL doesn't end with .md, assume it's a folder and add SKILL.md
        if (!rawUrl.toLowerCase().endsWith('.md')) {
          rawUrl = rawUrl.replace(/\/$/, '') + '/SKILL.md';
        }
      }
      // Handle: https://github.com/user/repo -> search for SKILL.md in repo
      else {
        new Notice('Searching for SKILL.md in repository...');
        const foundUrl = await findSkillInRepo(url);
        if (foundUrl) {
          rawUrl = foundUrl;
        } else {
          // Cannot find skill automatically
          throw new Error('Could not find SKILL.md in the repository. Please provide a direct link to the SKILL.md file or check the default branch.');
        }
      }
    }

    new Notice(`Downloading skill from ${rawUrl}...`);

    const response = await requestUrl({ url: rawUrl });

    if (response.status !== 200) {
      throw new Error(`Failed to download skill (Status: ${response.status}). Please check the URL.`);
    }

    const content = response.text;

    // Extract name from frontmatter
    const nameMatch = content.match(/^---\s*[\s\S]*?name:\s*([^\r\n]+)/);
    let skillName = '';

    if (nameMatch && nameMatch[1]) {
      skillName = nameMatch[1].trim();
    } else {
      // Fallback: try to derive from URL
      const urlParts = url.split('/');
      skillName = urlParts[urlParts.length - 1].replace(/\.md$/i, '') || 'unknown-skill';
    }

    // Sanitize name
    skillName = skillName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();

    if (!skillName) {
      throw new Error('Could not determine skill name. Please ensure the SKILL.md has a "name" field in frontmatter.');
    }

    const skillDir = path.join(providerSkillsRoot(vaultPath, providerId), skillName);

    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }

    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');

    new Notice(`✅ Skill "${skillName}" installed successfully!`);
    return true;

  } catch (error) {
    console.error('Failed to install skill from URL:', error);
    new Notice(`Failed to install skill: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
