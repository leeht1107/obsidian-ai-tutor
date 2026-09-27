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

import { findProviderCliPath, getConfiguredProviderCliPath, resolveProviderCliPath } from '@/core/providers/providerRegistry';

describe('findProviderCliPath with a configured path', () => {
  let dir: string;
  let cli: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), '.ocop-clipath-'));
    cli = path.join(dir, 'copilot');
    fs.writeFileSync(cli, '#!/bin/sh\n');
    fs.chmodSync(cli, 0o755);
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('resolves a path the student wrote with a tilde', () => {
    const tildePath = cli.replace(os.homedir(), '~');
    expect(findProviderCliPath('copilot', tildePath)).toBe(cli);
  });

  it('leaves an absolute path alone', () => {
    expect(findProviderCliPath('copilot', cli)).toBe(cli);
  });

  it('keeps a caller-supplied missing probe path strict', () => {
    expect(findProviderCliPath('copilot', path.join(dir, 'missing-probe'))).toBeNull();
  });

  it('resolves configured provider paths consistently, including the legacy Copilot field', () => {
    const legacy = { copilotCliPath: cli };
    expect(getConfiguredProviderCliPath(legacy, 'copilot')).toBe(cli);
    expect(resolveProviderCliPath(legacy, 'copilot')).toBe(cli);
    expect(resolveProviderCliPath({ providerCliPaths: { copilot: cli } }, 'copilot')).toBe(cli);
  });

  it('keeps a valid configured CLI path ahead of PATH discovery', () => {
    const discoveredDir = path.join(dir, 'discovered');
    fs.mkdirSync(discoveredDir);
    const discovered = path.join(discoveredDir, 'copilot');
    fs.writeFileSync(discovered, '#!/bin/sh\n');
    const previousPath = process.env.PATH;
    process.env.PATH = `${discoveredDir}${path.delimiter}${previousPath ?? ''}`;
    try {
      expect(resolveProviderCliPath({ providerCliPaths: { copilot: cli } }, 'copilot')).toBe(cli);
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('falls back to PATH when the configured CLI path is stale', () => {
    const discoveredDir = path.join(dir, 'path-bin');
    fs.mkdirSync(discoveredDir);
    const discovered = path.join(discoveredDir, 'copilot');
    fs.writeFileSync(discovered, '#!/bin/sh\n');
    const previousPath = process.env.PATH;
    process.env.PATH = `${discoveredDir}${path.delimiter}${previousPath ?? ''}`;
    try {
      expect(resolveProviderCliPath({ providerCliPaths: { copilot: path.join(dir, 'stale') } }, 'copilot'))
        .toBe(discovered);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
