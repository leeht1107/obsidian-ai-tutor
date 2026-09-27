import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveProviderCliPath } from '@/core/providers/providerRegistry';
import { checkProviderSetupStatus } from '@/core/setup/AutoSetupService';
import { checkProviderConnection } from '@/core/setup/providerConnection';
import { checkProviderReadiness } from '@/core/setup/providerReadiness';
import { DEFAULT_SETTINGS } from '@/core/types/settings';

describe('configured provider paths across setup and readiness', () => {
  let dir: string;
  let cli: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configured-provider-'));
    const script = path.join(dir, 'claude.js');
    fs.writeFileSync(script, 'console.log(JSON.stringify({ loggedIn: true }));\n');
    cli = process.platform === 'win32' ? path.join(dir, 'claude.cmd') : script;
    if (process.platform === 'win32') {
      fs.writeFileSync(cli, '@ECHO OFF\r\n"%_prog%" "%~dp0\\claude.js" %*\r\n');
    } else {
      fs.writeFileSync(script, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ loggedIn: true }));\n');
      fs.chmodSync(cli, 0o755);
    }
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('uses only a configured path for Setup Wizard installed/skip-install decisions', () => {
    const configuredOnly = { ...DEFAULT_SETTINGS, providerCliPaths: { claude: cli } };
    expect(checkProviderSetupStatus('claude', configuredOnly).cliFound).toBe(true);
    expect(resolveProviderCliPath(configuredOnly, 'claude')).toBe(cli);
  });

  it('uses the same configured path for readiness probes', async () => {
    const settings = { ...DEFAULT_SETTINGS, providerCliPaths: { claude: cli } };
    const result = await checkProviderReadiness('claude', { settings });
    expect(result.state).toBe('logged-in');
    await expect(checkProviderConnection('claude', { settings })).resolves.toBe('connected');
  });

  it('continues resolving the legacy Copilot path through the shared path resolver', () => {
    const configuredOnly = { ...DEFAULT_SETTINGS, copilotCliPath: cli };
    expect(resolveProviderCliPath(configuredOnly, 'copilot')).toBe(cli);
  });
});
