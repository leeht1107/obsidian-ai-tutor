/** The small file surface the record code needs; the Obsidian-backed version lives in storage. */
export interface RecordFs {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  /** Files (full vault-relative paths) and sub-folders directly under `folder`. */
  list(folder: string): Promise<{ files: string[]; folders: string[] }>;
  /**
   * Creates `path` only if absent and rejects when it already exists. Folder creation is part of
   * this call because it must happen only inside a save confirmation.
   */
  createOnly(path: string, content: string): Promise<void>;
  stat(path: string): Promise<{ size: number } | null>;
}
