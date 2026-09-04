import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guards against a CSS file being deleted while another component still borrows
 * a class from it. Removing the MCP feature deleted `modals/mcp-modal.css`, and
 * the quiz/socratic setup modals had borrowed `.ocop-mcp-buttons` from it — the
 * build stayed green while both modals silently lost their button layout.
 */

const SRC = join(__dirname, '../../../src');

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

describe('modal CSS class coverage', () => {
  const css = walk(join(SRC, 'style'), '.css')
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  const referenced = new Map<string, string>();
  for (const file of walk(join(SRC, 'ui/modals'), '.ts')) {
    const body = readFileSync(file, 'utf8');
    for (const match of body.matchAll(/ocop-[a-z0-9-]+/g)) {
      if (!referenced.has(match[0])) referenced.set(match[0], file);
    }
  }

  it('finds modal classes to check', () => {
    expect(referenced.size).toBeGreaterThan(10);
  });

  it('defines every ocop- class the modals reference', () => {
    const missing = [...referenced.entries()]
      .filter(([cls]) => !new RegExp(`\\.${cls}\\b`).test(css))
      .map(([cls, file]) => `${cls} (used in ${file.replace(SRC, 'src')})`);

    expect(missing).toEqual([]);
  });
});
