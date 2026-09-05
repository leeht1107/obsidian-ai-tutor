/**
 * A home-relative CLI path.
 *
 * The settings field validates what the student typed with expandHomePath, so
 * `~/bin/copilot` shows no error, while findProviderCliPath stat'ed the literal
 * string — which never exists. The path was accepted and then failed every
 * connection check and every request. Found by an independent reviewer.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { findProviderCliPath } from '@/core/providers/providerRegistry';

describe('findProviderCliPath with a configured path', () => {
  let dir: string;
  let cli: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.homedir(), '.ocop-clipath-'));
    cli = path.join(dir, 'copilot');
    fs.writeFileSync(cli, '#!/bin/sh\n');
    fs.chmodSync(cli, 0o755);
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('resolves a path the student wrote with a tilde', () => {
    const tildePath = cli.replace(os.homedir(), '~');
    expect(findProviderCliPath('copilot', tildePath)).toBe(cli);
  });

  it('still rejects a configured path that does not exist', () => {
    expect(findProviderCliPath('copilot', path.join(dir, 'nope'))).toBeNull();
  });

  it('leaves an absolute path alone', () => {
    expect(findProviderCliPath('copilot', cli)).toBe(cli);
  });
});
