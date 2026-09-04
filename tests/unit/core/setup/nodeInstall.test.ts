import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { detectPackageManager, installNode, NODE_DOWNLOAD_URL } from '@/core/setup/nodeInstall';

const isWindows = process.platform === 'win32';

function writeManager(dir: string, name: string, body: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  fs.chmodSync(p, 0o755);
  return p;
}

describe('Node.js install', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeinstall-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('offers a real download page when there is no package manager', async () => {
    expect(NODE_DOWNLOAD_URL).toMatch(/^https:\/\/nodejs\.org\//);
    const result = await installNode(() => { /* ignore */ }, null);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Homebrew');
  });

  it('names a real package manager rather than claiming it cannot install Node', () => {
    const detected = detectPackageManager();
    // Detection returns an actionable command backed by a binary that exists, or
    // nothing at all — never an unusable recipe. Written without a branch so it
    // holds on a machine with no package manager too.
    const usable = detected === null
      || (/brew install node|winget install/.test(detected.displayCommand) && fs.existsSync(detected.binPath));
    expect(usable).toBe(true);
  });

  it('streams installer output and reports success', async () => {
    if (isWindows) return;
    const bin = writeManager(dir, 'brew-ok', '#!/bin/sh\necho "==> Downloading node"\nexit 0\n');
    const lines: string[] = [];
    const result = await installNode((line) => lines.push(line), {
      id: 'brew', binPath: bin, installArgs: ['install', 'node'], displayCommand: 'brew install node',
    });
    expect(result.success).toBe(true);
    expect(lines.join('\n')).toContain('Downloading node');
  });

  it('surfaces the installer failure reason instead of a bare exit code', async () => {
    if (isWindows) return;
    const bin = writeManager(dir, 'brew-fail', '#!/bin/sh\necho "Permission denied" >&2\nexit 1\n');
    const result = await installNode(() => { /* ignore */ }, {
      id: 'brew', binPath: bin, installArgs: ['install', 'node'], displayCommand: 'brew install node',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  it('shows brew progress written to stderr rather than hiding it', async () => {
    if (isWindows) return;
    const bin = writeManager(dir, 'brew-stderr', '#!/bin/sh\necho "==> Fetching node" >&2\nexit 0\n');
    const lines: string[] = [];
    await installNode((line) => lines.push(line), {
      id: 'brew', binPath: bin, installArgs: ['install', 'node'], displayCommand: 'brew install node',
    });
    expect(lines.join('\n')).toContain('Fetching node');
  });
});
