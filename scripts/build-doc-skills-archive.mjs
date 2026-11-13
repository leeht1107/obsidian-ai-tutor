#!/usr/bin/env node
/**
 * Build assets/doc-skills-<short>.json.gz from a local clone of
 * anthropics/skills at the pinned commit, and print its sha256.
 *
 *   node scripts/build-doc-skills-archive.mjs <path to anthropics/skills clone>
 *
 * Reads blobs straight from git (`git ls-tree` / `git cat-file`), so the
 * clone's working tree and checked-out branch do not matter. The output is
 * deterministic: same commit, same bytes, same sha256.
 */
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';

const COMMIT = '2c5958ecac7cee2b583967a2c4981d0f4a75c579';
const SKILLS = ['pdf', 'xlsx', 'docx', 'pptx'];
const VERSION = COMMIT.slice(0, 8);

const clone = process.argv[2];
if (!clone) {
  console.error('usage: node scripts/build-doc-skills-archive.mjs <anthropics/skills clone>');
  process.exit(2);
}
const git = (...args) => execFileSync('git', ['-C', clone, ...args], { maxBuffer: 64 * 1024 * 1024 });

const skills = {};
const executables = {};
for (const name of SKILLS) {
  skills[name] = {};
  executables[name] = [];
  const listing = git('ls-tree', '-r', '-z', COMMIT, `skills/${name}/`).toString('utf8').split('\0').filter(Boolean);
  for (const line of listing.sort()) {
    const [meta, file] = line.split('\t');
    const [mode, type, blob] = meta.split(' ');
    if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error(`unsupported entry ${mode} ${type} ${file}`);
    const rel = file.slice(`skills/${name}/`.length);
    skills[name][rel] = git('cat-file', 'blob', blob).toString('base64');
    if (mode === '100755') executables[name].push(rel);
  }
}

const json = JSON.stringify({ version: VERSION, upstream: `anthropics/skills@${COMMIT}`, skills, executables });
// mtime 0 in the gzip header keeps the bytes reproducible.
const gz = gzipSync(Buffer.from(json), { level: 9 });
gz.writeUInt32LE(0, 4);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets', `doc-skills-${VERSION}.json.gz`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gz);
const counts = SKILLS.map((n) => `${n} ${Object.keys(skills[n]).length}`).join(', ');
console.log(`${out}\n${counts}\nbytes ${gz.length}\nsha256 ${createHash('sha256').update(gz).digest('hex')}`);
