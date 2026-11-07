import { createHash } from 'crypto';

/** Normalizes a vault-relative path; null when it is empty, absolute or escapes the vault. */
export function normalizeVaultPath(input: string): string | null {
  const raw = input.replace(/\\/g, '/').trim();
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw) || raw.includes('\0')) return null;
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') return null;
    parts.push(part);
  }
  return parts.length > 0 ? parts.join('/') : null;
}

export function isInsideFolder(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}

// eslint-disable-next-line no-control-regex -- control characters are illegal in file names
const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|#^[\]\0-\x1f]/g;

/** A bounded, readable file name; the extension is always `.md`. */
export function sanitizeFileName(name: string, fallback = '학습 기록'): string {
  const base = name.replace(/\.md$/i, '').replace(ILLEGAL_FILE_CHARS, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const bounded = Array.from(base || fallback).slice(0, 80).join('').trim();
  return `${bounded || fallback}.md`;
}

/** Folder + file name into one validated path, or null when it would leave the folder. */
export function resolveRecordPath(folder: string, fileName: string): string | null {
  const normalizedFolder = normalizeVaultPath(folder);
  if (!normalizedFolder) return null;
  if (/[\\/]/.test(fileName) || fileName.includes('\0')) return null;
  const safe = sanitizeFileName(fileName);
  const path = normalizeVaultPath(`${normalizedFolder}/${safe}`);
  return path && isInsideFolder(path, normalizedFolder) ? path : null;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
