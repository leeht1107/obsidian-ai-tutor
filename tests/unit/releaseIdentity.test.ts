import { execFileSync,spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const validatorPath = path.resolve(__dirname, '../../scripts/validate-release.js');

describe('release identity', () => {
  let dir: string;

  const writeFixture = (versions: Record<string, string> = { '0.1.27': '1.0.0' }) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.1.27' }));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '0.1.27', minAppVersion: '1.0.0' }));
    fs.writeFileSync(path.join(dir, 'versions.json'), JSON.stringify({ '0.1.26': '1.0.0', ...versions }));
  };

  const runValidator = (tag: string) => spawnSync(process.execPath, [validatorPath, tag, dir], { encoding: 'utf8' });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-identity-'));
    writeFixture();
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('accepts matching tag, package, manifest, and current versions mapping', () => {
    expect(runValidator('0.1.27').status).toBe(0);
  });

  it('rejects a mismatched tag', () => {
    const result = runValidator('0.1.26');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must equal package.json version');
  });

  it('rejects a mismatched package version', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.1.26' }));
    const result = runValidator('0.1.27');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must equal package.json version');
  });

  it('rejects a mismatched manifest version', () => {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '0.1.26', minAppVersion: '1.0.0' }));
    const result = runValidator('0.1.27');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('manifest.json version');
  });

  it('rejects missing or mismatched current compatibility mappings', () => {
    writeFixture({ '0.1.27': '1.0.1' });
    expect(runValidator('0.1.27').status).toBe(1);
    fs.writeFileSync(path.join(dir, 'versions.json'), JSON.stringify({ '0.1.26': '1.0.0' }));
    expect(runValidator('0.1.27').status).toBe(1);
  });

  it('syncs the current compatibility entry and preserves historical rows', () => {
    const scripts = path.join(dir, 'scripts');
    fs.mkdirSync(scripts);
    fs.writeFileSync(path.join(scripts, 'sync-version.js'), fs.readFileSync(path.join(__dirname, '../../scripts/sync-version.js')));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.1.27' }));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: '0.1.26', minAppVersion: '1.1.0' }));
    fs.writeFileSync(path.join(dir, 'versions.json'), JSON.stringify({ '0.1.26': '1.0.0', '0.1.27': '0.9.0' }));
    execFileSync(process.execPath, [path.join(scripts, 'sync-version.js')]);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const versions = JSON.parse(fs.readFileSync(path.join(dir, 'versions.json'), 'utf8'));
    expect(manifest.version).toBe('0.1.27');
    expect(versions).toEqual({ '0.1.26': '1.0.0', '0.1.27': '1.1.0' });
  });
});
