/**
 * Obsidian provides the `obsidian` module through require only. esbuild keeps
 * `await import('obsidian')` as a native dynamic import, which fails inside
 * Obsidian (ERR_MODULE_NOT_FOUND) while ts-jest turns it into require and passes.
 * 2026-11-13: this made the doc-skills download throw on every real install.
 * The same holds for node builtins: Node resolves `import('path')`, the
 * Obsidian renderer does not, so only require/static imports are safe.
 */
import * as fs from 'fs';
import * as path from 'path';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

it('never imports a package or node builtin dynamically (obsidian, path, os, fs...)', () => {
  const offenders = sourceFiles(path.join(__dirname, '../../src'))
    .filter((file) => /import\(\s*['"][^./'"][^'"]*['"]\s*\)/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(process.cwd(), file));
  expect(offenders).toEqual([]);
});
