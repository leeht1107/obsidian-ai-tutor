import * as fs from 'fs';
import type { App } from 'obsidian';
import * as nodePath from 'path';

import type { RecordFs } from '../learning/records/fs';

/** Obsidian-backed record file access. Reads and listings use the adapter, not getMarkdownFiles. */
/** The one primitive Obsidian's adapter lacks: create a file only if it does not exist. */
export interface ExclusiveCreate {
  createExclusive(absolutePath: string, content: string): Promise<void>;
}

/** `wx` is O_CREAT|O_EXCL: the OS refuses if anything, even a dangling symlink, is already there. */
export const nodeExclusiveCreate: ExclusiveCreate = {
  async createExclusive(absolutePath, content) {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(absolutePath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`already exists: ${absolutePath}`);
      throw error;
    }
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      // A failed write leaves the partial file on purpose; the save service reconciles by reading it.
      await handle.close();
    }
  },
};

function isInside(parent: string, child: string): boolean {
  const relative = nodePath.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !nodePath.isAbsolute(relative));
}

function assertSafePath(path: string): void {
  const segments = path.split('/').filter(Boolean);
  if (path.includes('\\') || segments.some((part) => part === '..' || part === '.')) {
    throw new Error(`invalid record path: ${path}`);
  }
}

/**
 * Resolves the folder (vault-relative, '' = vault root) once, symlinks included, and returns that
 * resolved path only if it is inside the vault; null when it does not exist yet. Callers must use
 * the returned path, never resolve the folder again.
 */
async function resolveInsideVault(base: string, folder: string, path: string): Promise<string | null> {
  assertSafePath(path);
  const realBase = await fs.promises.realpath(base);
  const target = nodePath.resolve(base, ...folder.split('/').filter(Boolean));
  let real: string;
  try {
    real = await fs.promises.realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; // not created yet; its parent was already checked
    throw error;
  }
  if (!isInside(realBase, real)) throw new Error(`record folder resolves outside the vault: ${path}`);
  return real;
}

/** Desktop-only: FileSystemAdapter exposes the vault's physical root; other adapters do not. */
function physicalBasePath(app: App): string | null {
  const adapter = app.vault.adapter as { getBasePath?: unknown };
  if (typeof adapter.getBasePath !== 'function') return null;
  const base: unknown = (adapter.getBasePath as () => unknown).call(adapter);
  return typeof base === 'string' && base.length > 0 ? base : null;
}

export class ObsidianRecordFs implements RecordFs {
  constructor(private readonly app: App, private readonly exclusive: ExclusiveCreate = nodeExclusiveCreate) {}

  exists(path: string): Promise<boolean> {
    return this.app.vault.adapter.exists(path);
  }

  read(path: string): Promise<string> {
    return this.app.vault.adapter.read(path);
  }

  async list(folder: string): Promise<{ files: string[]; folders: string[] }> {
    const listing = await this.app.vault.adapter.list(folder);
    return { files: listing.files, folders: listing.folders };
  }

  async stat(path: string): Promise<{ size: number } | null> {
    try {
      const stat = await this.app.vault.adapter.stat(path);
      return stat ? { size: stat.size } : null;
    } catch {
      return null;
    }
  }

  async createOnly(path: string, content: string): Promise<void> {
    // Every folder visibility goes through the physical base: containment is checked before any
    // folder is made, and the file is made with an OS-level exclusive create. Vault.create and the
    // adapter write are never used, so no path can reach outside the vault or overwrite a file.
    const base = physicalBasePath(this.app);
    if (base === null) {
      throw new Error(`unsupported: this vault adapter cannot create record files exclusively (${path})`);
    }
    if (await this.exists(path)) throw new Error(`already exists: ${path}`);
    const folder = path.substring(0, path.lastIndexOf('/'));
    let current = '';
    for (const part of folder.split('/').filter(Boolean)) {
      const parent = current;
      current = current ? `${current}/${part}` : part;
      await resolveInsideVault(base, parent, path);
      if (!(await this.exists(current))) await this.app.vault.adapter.mkdir(current);
    }
    await this.createExclusiveInside(base, path, content);
  }

  /**
   * The parent is resolved, then resolved again immediately before the create: the second result must
   * be the same path and still inside the vault, and that exact checked path is where `wx` creates the
   * file. A parent swapped in between is refused before any file is written. Nothing is deleted
   * afterwards: `wx` proves ownership of the file it created, not of whatever the pathname resolves
   * to later, so a failed or uncertain save leaves the file for the save service to reconcile.
   * Residual risk: Node has no portable openat, so a same-user process that rewrites vault
   * directories after this last check can still redirect the open; this is detected only before, not
   * prevented, and no OS-isolation claim is made.
   */
  private async createExclusiveInside(base: string, path: string, content: string): Promise<void> {
    const folder = path.substring(0, path.lastIndexOf('/'));
    const realParent = await resolveInsideVault(base, folder, path);
    if (realParent === null) throw new Error(`record folder was not created: ${path}`);
    const realBase = await fs.promises.realpath(base);
    const recheck = await fs.promises.realpath(realParent);
    if (recheck !== realParent || !isInside(realBase, recheck)) {
      throw new Error(`record folder resolves outside the vault: ${path}`);
    }
    await this.exclusive.createExclusive(nodePath.join(recheck, nodePath.basename(path)), content);
  }
}
