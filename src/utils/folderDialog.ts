/**
 * Finds a native folder picker from Obsidian's renderer.
 *
 * `@electron/remote` patches `remote` onto the electron module in the MAIN process only, so
 * `require('electron').remote` is undefined in a renderer — which is why the folder button
 * threw into a console-only catch and appeared to do nothing at all. The renderer's own
 * entry point is `require('@electron/remote')`; the legacy path is kept for older builds.
 */

export interface FolderDialog {
  showOpenDialog(options: { properties: string[]; title: string }): Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
}

type ModuleRequire = (moduleName: string) => unknown;

function readDialog(candidate: unknown): FolderDialog | null {
  const dialog = (candidate as { dialog?: unknown } | null | undefined)?.dialog;
  const hasPicker = typeof (dialog as FolderDialog | undefined)?.showOpenDialog === 'function';
  return hasPicker ? (dialog as FolderDialog) : null;
}

export function resolveFolderDialog(moduleRequire: ModuleRequire | undefined | null): FolderDialog | null {
  if (typeof moduleRequire !== 'function') return null;
  for (const attempt of [
    () => readDialog(moduleRequire('@electron/remote')),
    () => readDialog((moduleRequire('electron') as { remote?: unknown } | null)?.remote),
  ]) {
    try {
      const dialog = attempt();
      if (dialog) return dialog;
    } catch {
      // A missing module is expected on one path or the other; keep trying.
    }
  }
  return null;
}
