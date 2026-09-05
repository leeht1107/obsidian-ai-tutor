/**
 * Windows CLI resolution, learned from obsidian-copilot's claudeBinaryResolver.
 *
 * It refuses `claude.cmd` outright: "it requires `shell: true` and breaks SDK
 * stdio streaming". We reached the same hazard from the other side — our own
 * copilotCli notes that shell:true hands cmd.exe one command string, where
 * quotes, %, ^, & and Korean text get mangled — and a quiz prompt is long and
 * full of both.
 *
 * We still accept a .cmd, because parsing the shim works and dropping it would
 * strand npm-only installs. But the .exe must be preferred so the shim path is
 * only ever a fallback.
 *
 * No Windows machine was available; these pin the ordering, not the spawn.
 */
import * as fs from 'fs';

import { findProviderCliPath } from '@/core/providers/providerRegistry';

describe('Windows provider CLI resolution', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  afterEach(() => {
    if (platform) Object.defineProperty(process, 'platform', platform);
    jest.restoreAllMocks();
  });

  it('prefers the .exe over the .cmd shim in the same directory', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const present = new Set(['claude.cmd', 'claude.exe']);
    jest.spyOn(fs, 'statSync').mockImplementation(((p: string) => {
      const name = String(p).split(/[\\/]/).pop() as string;
      if (!present.has(name)) throw new Error('ENOENT');
      return { isFile: () => true } as fs.Stats;
    }) as unknown as typeof fs.statSync);

    const resolved = findProviderCliPath('claude');
    expect(resolved).toMatch(/claude\.exe$/);
  });

  it('prefers the .cmd shim over the extensionless script npm installs beside it', () => {
    // npm global installs drop three files: `claude` (a bash script),
    // `claude.cmd`, and `claude.ps1`. Windows cannot execute the extensionless
    // one at all — cmd.exe will not run a file with no extension, and
    // resolveCmdShim only understands .cmd — so putting it ahead of the shim
    // breaks every npm-installed CLI on Windows.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const present = new Set(['claude', 'claude.cmd', 'claude.ps1']);
    jest.spyOn(fs, 'statSync').mockImplementation(((p: string) => {
      const name = String(p).split(/[\\/]/).pop() as string;
      if (!present.has(name)) throw new Error('ENOENT');
      return { isFile: () => true } as fs.Stats;
    }) as unknown as typeof fs.statSync);

    expect(findProviderCliPath('claude')).toMatch(/claude\.cmd$/);
  });

  it('still finds the .cmd shim when no .exe exists', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    jest.spyOn(fs, 'statSync').mockImplementation(((p: string) => {
      if (!String(p).endsWith('claude.cmd')) throw new Error('ENOENT');
      return { isFile: () => true } as fs.Stats;
    }) as unknown as typeof fs.statSync);

    expect(findProviderCliPath('claude')).toMatch(/claude\.cmd$/);
  });
});
