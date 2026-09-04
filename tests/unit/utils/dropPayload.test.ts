import { dropCarriesAttachable, readDroppedVaultRefs } from '../../../src/utils/dropPayload';

/** Minimal DataTransfer stand-in; only the fields the reader touches. */
const dt = (data: Record<string, string>, files: { name: string; type?: string; path?: string }[] = []) => ({
  types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
  getData: (t: string) => data[t] ?? '',
  files: files as unknown as FileList,
});

describe('reading what was dropped on the chat box', () => {
  it('reads a note dragged out of the Obsidian file explorer', () => {
    // Obsidian's internal drag puts a wikilink on text/plain.
    expect(readDroppedVaultRefs(dt({ 'text/plain': '[[lecture/FD-01-600]]' }))).toEqual(['lecture/FD-01-600']);
  });

  it('strips a wikilink alias and heading so the path still resolves', () => {
    expect(readDroppedVaultRefs(dt({ 'text/plain': '[[notes/Week01|1주차]]' }))).toEqual(['notes/Week01']);
    expect(readDroppedVaultRefs(dt({ 'text/plain': '[[notes/Week01#정리]]' }))).toEqual(['notes/Week01']);
  });

  it('reads a markdown link, using the target rather than the label', () => {
    expect(readDroppedVaultRefs(dt({ 'text/plain': '[1주차](lecture/week01.md)' }))).toEqual(['lecture/week01.md']);
  });

  it('reads a bare vault path', () => {
    expect(readDroppedVaultRefs(dt({ 'text/plain': 'lecture/FD-01-600__jupyter-notebook.md' })))
      .toEqual(['lecture/FD-01-600__jupyter-notebook.md']);
  });

  it('reads several notes dragged at once', () => {
    expect(readDroppedVaultRefs(dt({ 'text/plain': '[[a/one]]\n[[b/two]]' }))).toEqual(['a/one', 'b/two']);
  });

  it('decodes an obsidian:// url', () => {
    expect(readDroppedVaultRefs(dt({ 'text/plain': 'obsidian://open?vault=Obsidian&file=lecture%2FFD-01' })))
      .toEqual(['lecture/FD-01']);
  });

  it('takes non-image files dropped from outside, by path when the OS gives one', () => {
    expect(readDroppedVaultRefs(dt({}, [{ name: 'notes.md', type: 'text/markdown', path: '/Users/x/v/notes.md' }])))
      .toEqual(['/Users/x/v/notes.md']);
  });

  it('falls back to the file name when the platform withholds the path', () => {
    // Electron 32 removed File.path; the vault resolver can still match on basename.
    expect(readDroppedVaultRefs(dt({}, [{ name: 'notes.md', type: 'text/markdown' }]))).toEqual(['notes.md']);
  });

  it('leaves images alone — those are attachments, not context files', () => {
    expect(readDroppedVaultRefs(dt({}, [
      { name: 'shot.png', type: 'image/png', path: '/tmp/shot.png' },
      { name: 'notes.md', type: 'text/markdown', path: '/tmp/notes.md' },
    ]))).toEqual(['/tmp/notes.md']);
  });

  it('ignores prose that is not a reference to anything', () => {
    expect(readDroppedVaultRefs(dt({ 'text/plain': 'this is just some sentence I dragged' }))).toEqual([]);
    expect(readDroppedVaultRefs(dt({ 'text/plain': '   ' }))).toEqual([]);
    expect(readDroppedVaultRefs(dt({}))).toEqual([]);
  });

  it('does not return the same note twice', () => {
    expect(readDroppedVaultRefs(dt({ 'text/plain': '[[a/one]]\na/one' }))).toEqual(['a/one']);
  });

  it('prefers dropped files over the text the drag also carried', () => {
    // A file drag from Finder often carries both; the file is the more precise reference.
    expect(readDroppedVaultRefs(dt({ 'text/plain': 'notes.md' }, [{ name: 'notes.md', path: '/tmp/notes.md' }])))
      .toEqual(['/tmp/notes.md']);
  });
});

describe('showing the drop affordance', () => {
  it('shows for an Obsidian note drag, which carries only text', () => {
    // Keying on 'Files' alone left an internal note drag with no visible drop target.
    expect(dropCarriesAttachable(['text/plain'])).toBe(true);
  });

  it('still shows for an OS file drag', () => {
    expect(dropCarriesAttachable(['Files'])).toBe(true);
    expect(dropCarriesAttachable(['text/uri-list'])).toBe(true);
  });

  it('stays hidden when the drag carries nothing usable', () => {
    expect(dropCarriesAttachable([])).toBe(false);
    expect(dropCarriesAttachable(['application/x-custom'])).toBe(false);
    expect(dropCarriesAttachable(undefined)).toBe(false);
  });
});
