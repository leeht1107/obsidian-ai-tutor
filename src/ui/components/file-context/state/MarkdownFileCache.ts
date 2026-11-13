/**
 * Cached vault files for @ mention search: every file Obsidian shows, not
 * only notes, so a student can point the CLI at a pdf, docx, xlsx or pptx.
 * Only the path is ever sent; file bytes never are. Hidden dot-folders are
 * not in the Vault API, and are filtered again here in case they appear.
 */

import type { App } from 'obsidian';
import type { TFile } from 'obsidian';

export class MarkdownFileCache {
  private app: App;
  private cachedFiles: TFile[] = [];
  private dirty = true;

  constructor(app: App) {
    this.app = app;
  }

  markDirty(): void {
    this.dirty = true;
  }

  getFiles(): TFile[] {
    if (this.dirty || this.cachedFiles.length === 0) {
      this.cachedFiles = this.app.vault.getFiles().filter((file) => !file.path.split('/').some((segment) => segment.startsWith('.')));
      this.dirty = false;
    }
    return this.cachedFiles;
  }
}
