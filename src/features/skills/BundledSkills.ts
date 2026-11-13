/**
 * Skills the plugin puts in place by itself, so a beginner never has to
 * install them: obsidian-markdown and json-canvas (written from strings in
 * this bundle) and Anthropic's pdf, xlsx, docx, pptx (unpacked from one
 * pinned, sha-checked archive).
 *
 * Each skill in each skills root has a record in plugin state:
 * - `installed`: the plugin wrote it. If the folder later disappears, the
 *   student deleted it, and the record turns `removed`.
 * - `kept`: a folder of that name was already there without our marker.
 *   Never touched.
 * - `removed`: never written again automatically. Only the Settings button
 *   clears it.
 * Nothing here deletes or overwrites a folder the plugin cannot prove it wrote.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { gunzipSync } from 'zlib';

import type { ProviderId } from '../../core/providers/providerRegistry';
import type { BundledSkillRecord, BundledSkillRecords } from '../../core/storage/StorageService';
import { autoSkillsRoot, isPluginOwnedSkill, resolveSkillFilePath, writeBundledSkill } from './ObsidianSkillsInstaller';

export { autoSkillsRoot };

export const MARKDOWN_SKILLS = ['obsidian-markdown', 'json-canvas'] as const;
export const DOC_SKILLS = ['pdf', 'xlsx', 'docx', 'pptx'] as const;
export const MARKDOWN_SKILLS_VERSION = 'md-1';

/** The folder name of the plugin's own marker inside a doc skill it unpacked. */
export const DOC_SKILL_MARKER = '.obsidian-ai-tutor-installed';
const STAGING_PREFIX = '.installing-';
/** The manual installer's swap folder; one we did not leave makes ownership unclear. */
const REPLACING_PREFIX = '.replacing-';
const STAGING_OWNER = '.obsidian-ai-tutor-staging';

/** Upper bounds for the pinned archive (docx alone has 61 files). */
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 32 * 1024 * 1024;
const MAX_FILES_PER_SKILL = 120;

export interface DocArchive {
  version: string;
  /** skill → relative path → file bytes */
  skills: Record<string, Record<string, Buffer>>;
  /** skill → relative paths that upstream marks executable */
  executables: Record<string, string[]>;
}

/**
 * Unpack the pinned archive: gzip of JSON `{version, skills: {name: {path: base64}}}`.
 * A JSON bundle cannot carry links, devices or absolute names, so the only
 * checks left are the hash, the size, the exact skill list and each path.
 * Throws on any doubt; the caller then writes nothing.
 */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** A path every student's file system stores as written: no device names, no trailing dot or space, no staging names. */
function portableArchivePath(rel: string): boolean {
  return rel.split('/').every((s) =>
    !s.startsWith(STAGING_PREFIX) && !WINDOWS_DEVICE.test(s) && !/[. ]$/.test(s) && !/[<>:"|?*]/.test(s) && ![...s].some((c) => c.charCodeAt(0) < 0x20));
}

export function parseDocArchive(gz: Buffer, expectedSha256: string): DocArchive {
  if (gz.length > MAX_ARCHIVE_BYTES) throw new Error('archive too large');
  const sha = createHash('sha256').update(gz).digest('hex');
  if (sha !== expectedSha256) throw new Error(`archive sha256 mismatch: ${sha}`);
  const json = gunzipSync(gz, { maxOutputLength: MAX_UNPACKED_BYTES * 2 });
  const text = json.toString('utf-8');
  const raw = JSON.parse(text) as { version?: unknown; skills?: unknown; executables?: unknown };
  // JSON.parse keeps the last of two equal keys; the builder writes plain
  // JSON.stringify output, so any duplicate or reformatting shows up here.
  if (JSON.stringify(raw) !== text) throw new Error('archive is not canonical JSON');
  if (typeof raw.version !== 'string' || !raw.skills || typeof raw.skills !== 'object') throw new Error('archive shape');
  const names = Object.keys(raw.skills).sort();
  if (names.join(',') !== [...DOC_SKILLS].sort().join(',')) throw new Error(`archive skills: ${names.join(',')}`);
  const skills: DocArchive['skills'] = {};
  let total = 0;
  for (const name of names) {
    const entries = (raw.skills as Record<string, unknown>)[name];
    if (!entries || typeof entries !== 'object') throw new Error(`archive skill ${name}`);
    const files: Record<string, Buffer> = {};
    const paths = Object.keys(entries);
    if (paths.length > MAX_FILES_PER_SKILL) throw new Error(`archive skill ${name}: too many files`);
    const folded = new Set<string>();
    for (const rel of paths) {
      const body = (entries as Record<string, unknown>)[rel];
      if (typeof body !== 'string') throw new Error(`archive entry ${name}/${rel}`);
      if (!resolveSkillFilePath('/x', rel) || !portableArchivePath(rel) || rel === DOC_SKILL_MARKER) {
        throw new Error(`archive path ${name}/${rel}`);
      }
      // macOS and Windows folders ignore case (and macOS Unicode normalization), so two such names would be one file.
      if (folded.has(rel.normalize('NFC').toLowerCase())) throw new Error(`archive path ${name}/${rel}: case collision`);
      folded.add(rel.normalize('NFC').toLowerCase());
      if (!BASE64.test(body)) throw new Error(`archive entry ${name}/${rel}: not base64`);
      files[rel] = Buffer.from(body, 'base64');
      total += files[rel].length;
    }
    // `a` and `a/b` cannot both be written: one would have to be a file and a folder.
    for (const rel of paths) {
      const segs = rel.normalize('NFC').toLowerCase().split('/');
      for (let i = 1; i < segs.length; i++) {
        if (folded.has(segs.slice(0, i).join('/'))) throw new Error(`archive path ${name}/${rel}: under a file`);
      }
    }
    if (!files['SKILL.md'] || !files['LICENSE.txt']) throw new Error(`archive skill ${name}: SKILL.md or LICENSE.txt missing`);
    skills[name] = files;
  }
  if (total > MAX_UNPACKED_BYTES) throw new Error('archive unpacks too large');
  const executables: DocArchive['executables'] = {};
  const rawExec = (raw.executables ?? {}) as Record<string, unknown>;
  for (const name of names) {
    const list = rawExec[name] ?? [];
    if (!Array.isArray(list) || list.some((rel) => typeof rel !== 'string' || !(rel in skills[name]))) throw new Error(`archive executables ${name}`);
    executables[name] = list as string[];
  }
  return { version: raw.version, skills, executables };
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Every file under `dir`, as relative POSIX paths, without following links. */
function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const inner = listFiles(path.join(dir, entry.name), rel);
      // An empty folder is content too (the student's), so it must show up.
      out.push(...(inner.length > 0 ? inner : [`${rel}/`]));
    } else out.push(rel);
  }
  return out;
}

function digestsOf(files: Record<string, Buffer>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([rel, body]) => [rel, sha256(body)]));
}

/** True when the folder holds exactly the files we recorded, byte for byte. */
function matchesRecord(dir: string, files: Record<string, string> | undefined): boolean {
  if (!files) return false;
  // The owner file is gone once an install completes, so here it is content
  // like any other (a crash right after the rename leaves it: then `kept`).
  const present = listFiles(dir).filter((rel) => rel !== DOC_SKILL_MARKER).sort();
  const expected = Object.keys(files).sort();
  if (present.join('\n') !== expected.join('\n')) return false;
  return expected.every((rel) => sha256(fs.readFileSync(path.join(dir, rel))) === files[rel]);
}

/**
 * Unpack one doc skill next to its final place, then rename it in. If a
 * folder of that name appears meanwhile, the staging copy is dropped and the
 * other folder wins. A leftover staging folder without our owner file is the
 * student's and is never removed.
 */
function installDocSkill(rootAbs: string, name: string, files: Record<string, Buffer>, version: string, executables: string[] = []): void {
  const staging = path.join(rootAbs, `${STAGING_PREFIX}${name}`);
  if (fs.existsSync(staging)) {
    if (!fs.existsSync(path.join(staging, STAGING_OWNER))) throw new Error(`${staging} is not ours; left as is`);
    // The owner file proves we made the folder, not that we made everything in it now.
    const extra = listFiles(staging).filter((rel) => rel !== STAGING_OWNER && rel !== DOC_SKILL_MARKER && !(rel in files));
    if (extra.length > 0) throw new Error(`${staging} holds files we did not write (${extra.slice(0, 3).join(', ')}); left as is`);
    fs.rmSync(staging, { recursive: true, force: true });
  }
  fs.mkdirSync(staging);
  const finalDir = path.join(rootAbs, name);
  try {
    fs.writeFileSync(path.join(staging, STAGING_OWNER), version);
    for (const [rel, body] of Object.entries(files)) {
      const target = resolveSkillFilePath(staging, rel);
      if (!target) throw new Error(`unsafe path ${rel}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
    if (process.platform !== 'win32') {
      for (const rel of executables) fs.chmodSync(path.join(staging, rel), 0o755);
    }
    fs.writeFileSync(path.join(staging, DOC_SKILL_MARKER), `${version}\n`);
    if (fs.existsSync(finalDir)) throw new Error(`${finalDir} appeared during install; left as is`);
    // The owner file stays until after the rename: a crash before it leaves a
    // staging folder the next run can prove is its own and clean up.
    fs.renameSync(staging, finalDir);
  } catch (error) {
    // We made this folder a moment ago (mkdir without recursive fails if it existed).
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  fs.rmSync(path.join(finalDir, STAGING_OWNER), { force: true });
}

/** Swap an unmodified older copy for the new version; the old copy is ours by digest. */
function replaceDocSkill(rootAbs: string, name: string, files: Record<string, Buffer>, version: string, executables: string[]): void {
  const finalDir = path.join(rootAbs, name);
  const old = path.join(rootAbs, `${STAGING_PREFIX}${name}-old`);
  if (fs.existsSync(old)) throw new Error(`${old} exists; left as is`);
  fs.renameSync(finalDir, old);
  try {
    installDocSkill(rootAbs, name, files, version, executables);
  } catch (error) {
    if (!fs.existsSync(finalDir)) fs.renameSync(old, finalDir);
    throw error;
  }
  fs.rmSync(old, { recursive: true, force: true });
}

export interface LegacyEvidence {
  /** data.json existed before this version first ran. */
  legacyUser: boolean;
  /** The provider this ensure runs for: its 0.1.51 folder is the evidence. */
  provider?: ProviderId;
  skillsAutoInstalled?: Partial<Record<ProviderId, boolean>>;
}

/** Whether a missing markdown skill counts as deleted by a student from 0.1.51 or older. */
export function legacyMarkdownRemoved(_vaultPath: string, _root: string, _name: string, evidence: LegacyEvidence): boolean {
  // 0.1.51 erased skillsAutoInstalled on settings saves, so no flag pattern
  // proves "never installed here", and no old copy proves "not deleted here":
  // the shared `.agents/skills` was agy's own folder, so a copilot or codex
  // copy elsewhere says nothing about a deletion there. For a student from
  // before this version a missing markdown skill is therefore deleted (D8,
  // plan §3); old copies stay where they are, and Settings Install restores.
  return evidence.legacyUser;
}

export interface EnsureInput {
  vaultPath: string;
  root: string;
  records: Record<string, BundledSkillRecord>;
  markdownBodies: Record<string, string>;
  evidence: LegacyEvidence;
  /** The verified archive, or null while it cannot be had (offline). */
  getArchive: () => Promise<DocArchive | null>;
}

export interface EnsureResult {
  records: Record<string, BundledSkillRecord>;
  installed: string[];
  pending: string[];
  errors: string[];
}

/** Bring one skills root in line with its records. Pure filesystem work; the caller persists `records`. */
export async function ensureRoot(input: EnsureInput): Promise<EnsureResult> {
  const { vaultPath, root, evidence } = input;
  const rootAbs = path.join(vaultPath, root);
  const records = { ...input.records };
  const result: EnsureResult = { records, installed: [], pending: [], errors: [] };

  for (const name of MARKDOWN_SKILLS) {
    const rec = records[name];
    const file = path.join(rootAbs, name, 'SKILL.md');
    const exists = fs.existsSync(file);
    if (rec?.state === 'removed' || rec?.state === 'kept') continue;
    if (rec?.state === 'installed') {
      if (!exists) records[name] = { ...rec, state: 'removed' };
      continue;
    }
    if (exists) {
      records[name] = { version: MARKDOWN_SKILLS_VERSION, state: isPluginOwnedSkill(fs.readFileSync(file, 'utf-8')) ? 'installed' : 'kept' };
      continue;
    }
    // A same-name folder without SKILL.md is someone's work in progress: never write into it.
    if (fs.existsSync(path.join(rootAbs, name))) {
      records[name] = { version: MARKDOWN_SKILLS_VERSION, state: 'kept' };
      continue;
    }
    if (legacyMarkdownRemoved(vaultPath, root, name, evidence)) {
      records[name] = { version: MARKDOWN_SKILLS_VERSION, state: 'removed' };
      continue;
    }
    try {
      const outcome = writeBundledSkill(rootAbs, name, input.markdownBodies[name]);
      records[name] = { version: MARKDOWN_SKILLS_VERSION, state: outcome === 'written' ? 'installed' : 'kept' };
      if (outcome === 'written') result.installed.push(name);
    } catch (error) {
      result.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let archive: DocArchive | null | undefined;
  const loadArchive = async () => (archive === undefined ? (archive = await input.getArchive()) : archive);

  for (const name of DOC_SKILLS) {
    const rec = records[name];
    const dir = path.join(rootAbs, name);
    const exists = fs.existsSync(dir);
    if (rec?.state === 'removed' || rec?.state === 'kept') continue;
    try {
      // An update cut off after moving the old copy aside, or another tool's
      // swap folder: who owns what is unclear, so touch nothing and say so.
      const unclear = [`${STAGING_PREFIX}${name}-old`, `${REPLACING_PREFIX}${name}`].find((f) => fs.existsSync(path.join(rootAbs, f)));
      if (unclear) {
        result.errors.push(`${name}: ${path.join(root, unclear)} is left over; move or delete it, then press Install`);
        continue;
      }
      if (rec?.state === 'installed') {
        if (!exists) { records[name] = { ...rec, state: 'removed' }; continue; }
        const latest = await loadArchive();
        if (!latest || latest.version === rec.version) continue;
        // No marker means the student took the folder over: never replace it.
        if (!fs.existsSync(path.join(dir, DOC_SKILL_MARKER)) || !matchesRecord(dir, rec.files)) { records[name] = { ...rec, state: 'kept' }; continue; }
        replaceDocSkill(rootAbs, name, latest.skills[name], latest.version, latest.executables[name]);
        records[name] = { version: latest.version, state: 'installed', files: digestsOf(latest.skills[name]) };
        continue;
      }
      if (exists) {
        // A folder we did not record (e.g. the record write was cut off):
        // ours only if it carries our marker and the archive's exact bytes.
        if (!fs.existsSync(path.join(dir, DOC_SKILL_MARKER))) { records[name] = { version: '', state: 'kept' }; continue; }
        const latest = await loadArchive();
        if (!latest) { result.pending.push(name); continue; }
        const files = digestsOf(latest.skills[name]);
        records[name] = matchesRecord(dir, files)
          ? { version: latest.version, state: 'installed', files }
          : { version: latest.version, state: 'kept' };
        continue;
      }
      const latest = await loadArchive();
      if (!latest) { result.pending.push(name); continue; }
      fs.mkdirSync(rootAbs, { recursive: true });
      installDocSkill(rootAbs, name, latest.skills[name], latest.version, latest.executables[name]);
      records[name] = { version: latest.version, state: 'installed', files: digestsOf(latest.skills[name]) };
      result.installed.push(name);
    } catch (error) {
      result.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export type { BundledSkillRecords };

/**
 * After a Settings Install: the doc skills that are still missing because a
 * same-name folder is in the way (the plugin never writes into a folder it
 * cannot prove is its own). Null when nothing is in the way, so the button is
 * never a silent no-op.
 */
export function docInstallLeftoverMessage(vaultPath: string, root: string, names: string[]): string | null {
  const blocked = names.filter((name) =>
    fs.existsSync(path.join(vaultPath, root, name)) && !fs.existsSync(path.join(vaultPath, root, name, 'SKILL.md')));
  if (blocked.length === 0) return null;
  return `${blocked.join(', ')}: 같은 이름의 폴더가 이미 있고 내용이 달라 덮어쓰지 않았어요. `
    + `${blocked.map((name) => `${root}/${name}`).join(', ')} 폴더를 다른 곳으로 옮기거나 지운 뒤 다시 설치를 누르세요.`;
}
