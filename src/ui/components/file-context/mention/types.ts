import type { TFile } from 'obsidian';

export interface FileMentionItem {
  type: 'file';
  name: string;
  path: string;
  file: TFile;
}

export interface ContextFileMentionItem {
  type: 'context-file';
  name: string;
  absolutePath: string;
  contextRoot: string;
  folderName: string;
}

export interface ContextFolderMentionItem {
  type: 'context-folder';
  name: string;
  contextRoot: string;
  folderName: string;
}

/** A folder inside the vault, attached so the CLI can explore it itself. */
export interface VaultFolderMentionItem {
  type: 'vault-folder';
  name: string;
  path: string;
}

export type MentionItem =
  | FileMentionItem
  | ContextFileMentionItem
  | ContextFolderMentionItem
  | VaultFolderMentionItem;

export interface ExternalContextEntry {
  contextRoot: string;
  folderName: string;
  displayName: string;
  displayNameLower: string;
}

export function createExternalContextEntry(
  contextRoot: string,
  folderName: string,
  displayName: string
): ExternalContextEntry {
  return {
    contextRoot,
    folderName,
    displayName,
    displayNameLower: displayName.toLowerCase(),
  };
}
