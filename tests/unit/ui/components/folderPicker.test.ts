import { resolveFolderDialog } from '../../../../src/utils/folderDialog';

/**
 * The folder icon opened nothing and said nothing. It reached for `require('electron').remote`,
 * which `@electron/remote` only patches onto the MAIN process — in Obsidian's renderer that
 * property is undefined, so the call threw straight into a console-only catch.
 */
describe('resolving a folder picker in the Obsidian renderer', () => {
  const dialog = { showOpenDialog: jest.fn() };

  it('uses @electron/remote, which is where the renderer actually gets it', () => {
    const req = jest.fn((m: string) => (m === '@electron/remote' ? { dialog } : {}));
    expect(resolveFolderDialog(req)).toBe(dialog);
    expect(req).toHaveBeenCalledWith('@electron/remote');
  });

  it('falls back to the legacy electron.remote for older builds', () => {
    const req = jest.fn((m: string) => {
      if (m === '@electron/remote') throw new Error('Cannot find module');
      return { remote: { dialog } };
    });
    expect(resolveFolderDialog(req)).toBe(dialog);
  });

  it('returns null instead of throwing when neither is available', () => {
    // This is the case that used to surface as "the icon does nothing".
    const req = jest.fn(() => ({}));
    expect(resolveFolderDialog(req)).toBeNull();
  });

  it('returns null when require itself is missing', () => {
    expect(resolveFolderDialog(undefined)).toBeNull();
  });

  it('ignores a module that is present but has no usable dialog', () => {
    const req = jest.fn(() => ({ dialog: {} }));
    expect(resolveFolderDialog(req)).toBeNull();
  });
});
