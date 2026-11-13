/**
 * Getting the pinned doc-skills archive onto this computer.
 *
 * BRAT installs only main.js, manifest.json and styles.css, so the archive is
 * fetched once from an immutable commit URL of this repo, checked against a
 * hash compiled into the plugin, and cached in the plugin folder. Every skills
 * root after that installs offline from the cache.
 *
 * A classroom of 40 students on one connection is the case to plan for: one
 * download in flight per plugin, a random delay before it, and a growing,
 * jittered wait after each failure. A failure writes nothing.
 */
import * as fs from 'fs';
import * as path from 'path';

import { type DocArchive, parseDocArchive } from './BundledSkills';

export const DOC_ARCHIVE = {
  version: '2c5958ec',
  file: 'doc-skills-2c5958ec.json.gz',
  sha256: 'fa581d768a9b24563fff58fcdc6305b35b87984f3537b90dc51224e6422e4475',
  repo: 'leeht1107/obsidian-ai-tutor',
  /** The pushed commit that holds the archive (an immutable raw URL); empty means download nothing. */
  commit: '6ab194f3aef0a8ee501c827700646165a97ea22d',
};

export function archiveUrl(pin = DOC_ARCHIVE): string | null {
  if (!/^[0-9a-f]{40}$/.test(pin.commit)) return null;
  return `https://raw.githubusercontent.com/${pin.repo}/${pin.commit}/assets/${pin.file}`;
}

const HOUR = 60 * 60 * 1000;

export interface ArchiveSourceDeps {
  cacheDir: string;
  /** Resolve with the body on HTTP 200; reject or resolve null otherwise. */
  fetchBytes: (url: string) => Promise<Buffer | null>;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pin?: typeof DOC_ARCHIVE;
  /** Where the wait after failures survives a restart (else it is per launch). */
  retry?: { load: () => RetryState | null; save: (state: RetryState) => void };
  /** Longest random wait before the first download (spreads a classroom). */
  startJitterMs?: number;
}

export interface RetryState { failures: number; nextTryAt: number }

export interface ArchiveSource {
  get: () => Promise<DocArchive | null>;
  /** Failed attempts since the last success; for the once-a-day notice. */
  failures: () => number;
}

export function createArchiveSource(deps: ArchiveSourceDeps): ArchiveSource {
  const pin = deps.pin ?? DOC_ARCHIVE;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cacheFile = path.join(deps.cacheDir, pin.file);
  let parsed: DocArchive | null = null;
  let inFlight: Promise<DocArchive | null> | null = null;
  const restored = deps.retry?.load();
  let failures = restored?.failures ?? 0;
  let nextTryAt = restored?.nextTryAt ?? 0;
  let firstTry = true;

  const readCache = (): DocArchive | null => {
    try {
      return fs.existsSync(cacheFile) ? parseDocArchive(fs.readFileSync(cacheFile), pin.sha256) : null;
    } catch {
      return null; // a damaged cache is ignored, and replaced on the next good download
    }
  };

  const download = async (): Promise<DocArchive | null> => {
    const url = archiveUrl(pin);
    if (!url || now() < nextTryAt) return null;
    if (firstTry) {
      firstTry = false;
      await sleep(Math.floor(random() * (deps.startJitterMs ?? 30_000)));
    }
    try {
      const body = await deps.fetchBytes(url);
      if (!body) throw new Error('no body');
      const archive = parseDocArchive(body, pin.sha256);
      fs.mkdirSync(deps.cacheDir, { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, cacheFile);
      } catch (error) {
        fs.rmSync(tmp, { force: true }); // our own temp file; leave nothing half-written
        throw error;
      }
      failures = 0;
      deps.retry?.save({ failures, nextTryAt: 0 });
      return archive;
    } catch {
      failures += 1;
      const wait = Math.min(24 * HOUR, HOUR * 2 ** (failures - 1));
      nextTryAt = now() + Math.floor(wait * (0.5 + random()));
      deps.retry?.save({ failures, nextTryAt });
      return null;
    }
  };

  return {
    failures: () => failures,
    get: async () => {
      if (parsed) return parsed;
      parsed = readCache();
      if (parsed) return parsed;
      if (!inFlight) inFlight = download().finally(() => { inFlight = null; });
      parsed = await inFlight;
      return parsed;
    },
  };
}
